import { Pool } from 'pg';
import { Point, Room, RoomWithMeasurements, RoomMeasurements, RoomUpdate } from '../types/room';
import { GeometryCalculator } from '../utils/geometry';

export class RoomRepository {
    constructor(private pool: Pool) {}

    async createRoom(
        name: string,
        customer_id: string,
        company_id: string,
        points: Point[],
        notes: string = '',
        floor_type: string = 'default',
        measurements: RoomMeasurements = {
            trueArea: 0,
            carpetArea: 0,
            truePerimeter: 0,
            carpetPerimeter: 0
        }
    ): Promise<Room> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Create room record
            const roomResult = await client.query(
                `INSERT INTO rooms (name, customer_id, company_id, notes, floor_type)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, created_at, updated_at`,
                [name, customer_id, company_id, notes, floor_type]
            );

            const roomId = roomResult.rows[0].id;
            const created_at = roomResult.rows[0].created_at;
            const updated_at = roomResult.rows[0].updated_at;

            // Insert measurements
            await client.query(
                `INSERT INTO room_measurements (
                    room_id, 
                    x_coordinate, 
                    y_coordinate, 
                    true_area, 
                    carpet_area, 
                    true_perimeter, 
                    carpet_perimeter,
                    point_order
                )
                SELECT 
                    $1 as room_id,
                    unnest($2::float[]) as x_coordinate,
                    unnest($3::float[]) as y_coordinate,
                    $4 as true_area,
                    $5 as carpet_area,
                    $6 as true_perimeter,
                    $7 as carpet_perimeter,
                    generate_series(0, array_length($2::float[], 1) - 1) as point_order`,
                [
                    roomId,
                    points.map((p: Point) => p.x),
                    points.map((p: Point) => p.y),
                    measurements.trueArea,
                    measurements.carpetArea,
                    measurements.truePerimeter,
                    measurements.carpetPerimeter
                ]
            );

            await client.query('COMMIT');

            return {
                id: roomId,
                name,
                customer_id,
                company_id,
                points,
                notes,
                floor_type,
                measurements,
                created_at,
                updated_at
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async updateRoom(
        roomId: number,
        update: RoomUpdate
    ): Promise<Room> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Update room record if needed
            if (update.name || update.notes || update.floor_type) {
                await client.query(
                    `UPDATE rooms
                     SET name = COALESCE($1, name),
                         notes = COALESCE($2, notes),
                         floor_type = COALESCE($3, floor_type)
                     WHERE id = $4`,
                    [update.name, update.notes, update.floor_type, roomId]
                );
            }

            // Update measurements if provided
            if (update.points || update.measurements) {
                // First delete existing measurements
                await client.query(
                    `DELETE FROM room_measurements WHERE room_id = $1`,
                    [roomId]
                );

                // Then insert new measurements
                if (update.points) {
                    await client.query(
                        `INSERT INTO room_measurements (
                            room_id, 
                            x_coordinate, 
                            y_coordinate, 
                            true_area, 
                            carpet_area, 
                            true_perimeter, 
                            carpet_perimeter,
                            point_order
                        )
                        SELECT 
                            $1 as room_id,
                            unnest($2::float[]) as x_coordinate,
                            unnest($3::float[]) as y_coordinate,
                            $4 as true_area,
                            $5 as carpet_area,
                            $6 as true_perimeter,
                            $7 as carpet_perimeter,
                            generate_series(0, array_length($2::float[], 1) - 1) as point_order`,
                        [
                            roomId,
                            update.points.map(p => p.x),
                            update.points.map(p => p.y),
                            update.measurements?.trueArea || 0,
                            update.measurements?.carpetArea || 0,
                            update.measurements?.truePerimeter || 0,
                            update.measurements?.carpetPerimeter || 0
                        ]
                    );
                }
            }

            await client.query('COMMIT');

            // Fetch and return updated room
            const result = await client.query(
                `SELECT r.*, 
                        rm.x_coordinate,
                        rm.y_coordinate,
                        rm.true_area,
                        rm.carpet_area,
                        rm.true_perimeter,
                        rm.carpet_perimeter,
                        r.created_at,
                        r.updated_at
                 FROM rooms r
                 JOIN room_measurements rm ON r.id = rm.room_id
                 WHERE r.id = $1
                 ORDER BY rm.point_order`,
                [roomId]
            );

            const room = result.rows[0];
            return {
                id: room.id,
                name: room.name,
                customer_id: room.customer_id,
                company_id: room.company_id,
                points: result.rows.map(row => ({
                    x: parseFloat(row.x_coordinate),
                    y: parseFloat(row.y_coordinate)
                })),
                notes: room.notes,
                floor_type: room.floor_type,
                measurements: {
                    trueArea: room.true_area,
                    carpetArea: room.carpet_area,
                    truePerimeter: room.true_perimeter,
                    carpetPerimeter: room.carpet_perimeter
                },
                created_at: room.created_at,
                updated_at: room.updated_at
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getRoomById(id: number): Promise<RoomWithMeasurements> {
        const roomResult = await this.pool.query(
            'SELECT * FROM rooms WHERE id = $1',
            [id]
        );

        const pointsResult = await this.pool.query(
            'SELECT x_coordinate, y_coordinate FROM room_measurements WHERE room_id = $1 ORDER BY point_order',
            [id]
        );

        const room = roomResult.rows[0];
        const points = pointsResult.rows.map(row => ({
            x: parseFloat(row.x_coordinate),
            y: parseFloat(row.y_coordinate)
        }));

        return this.addMeasurements({
            ...room,
            points
        });
    }

    async getRoomsByCustomer(customer_id: string): Promise<RoomWithMeasurements[]> {
        const roomsResult = await this.pool.query(
            'SELECT * FROM rooms WHERE customer_id = $1',
            [customer_id]
        );

        const rooms = await Promise.all(roomsResult.rows.map(async (room) => {
            const pointsResult = await this.pool.query(
                'SELECT x_coordinate, y_coordinate FROM room_measurements WHERE room_id = $1 ORDER BY point_order',
                [room.id]
            );

            const points = pointsResult.rows.map(row => ({
                x: parseFloat(row.x_coordinate),
                y: parseFloat(row.y_coordinate)
            }));

            return this.addMeasurements({
                ...room,
                points
            });
        }));

        return rooms;
    }

    async deleteRoom(id: number): Promise<void> {
        await this.pool.query('DELETE FROM rooms WHERE id = $1', [id]);
    }

    private addMeasurements(room: Room): RoomWithMeasurements {
        const trueArea = GeometryCalculator.calculateArea(room.points);
        const truePerimeter = GeometryCalculator.calculatePerimeter(room.points);
        const { carpetArea, carpetPerimeter } = GeometryCalculator.calculateCarpetMeasurements(room.points);

        return {
            ...room,
            measurements: {
                trueArea,
                carpetArea,
                truePerimeter,
                carpetPerimeter
            }
        };
    }
}