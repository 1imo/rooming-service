import { Pool } from 'pg';
import { Point, Room, RoomWithMeasurements } from '../types/room';
import { GeometryCalculator } from '../utils/geometry';

export class RoomRepository {
    constructor(private pool: Pool) {}

    async createRoom(
        name: string,
        customer_id: string,
        company_id: string,
        points: Point[],
        notes?: string,
        floor_type?: string
    ): Promise<RoomWithMeasurements> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Create room record
            const roomResult = await client.query(
                `INSERT INTO rooms (name, customer_id, company_id, notes, floor_type)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [name, customer_id, company_id, notes, floor_type]
            );

            const room = roomResult.rows[0];

            // Insert points
            for (let i = 0; i < points.length; i++) {
                await client.query(
                    `INSERT INTO room_measurements (room_id, point_order, x_coordinate, y_coordinate)
                     VALUES ($1, $2, $3, $4)`,
                    [room.id, i, points[i].x, points[i].y]
                );
            }

            await client.query('COMMIT');

            return this.addMeasurements({
                ...room,
                points
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async updateRoom(
        id: number,
        updates: {
            name?: string;
            points?: Point[];
            notes?: string;
            floor_type?: string;
        }
    ): Promise<RoomWithMeasurements> {
        const client = await this.pool.connect();

        try {
            await client.query('BEGIN');

            // Update room details
            if (updates.name || updates.notes || updates.floor_type) {
                const setFields = [];
                const values = [];
                let valueCount = 1;

                if (updates.name) {
                    setFields.push(`name = $${valueCount}`);
                    values.push(updates.name);
                    valueCount++;
                }
                if (updates.notes !== undefined) {
                    setFields.push(`notes = $${valueCount}`);
                    values.push(updates.notes);
                    valueCount++;
                }
                if (updates.floor_type !== undefined) {
                    setFields.push(`floor_type = $${valueCount}`);
                    values.push(updates.floor_type);
                    valueCount++;
                }

                await client.query(
                    `UPDATE rooms 
                     SET ${setFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
                     WHERE id = $${valueCount}`,
                    [...values, id]
                );
            }

            // Update points if provided
            if (updates.points) {
                // Delete existing points
                await client.query('DELETE FROM room_measurements WHERE room_id = $1', [id]);

                // Insert new points
                for (let i = 0; i < updates.points.length; i++) {
                    await client.query(
                        `INSERT INTO room_measurements (room_id, point_order, x_coordinate, y_coordinate)
                         VALUES ($1, $2, $3, $4)`,
                        [id, i, updates.points[i].x, updates.points[i].y]
                    );
                }
            }

            await client.query('COMMIT');

            // Fetch updated room
            return this.getRoomById(id);
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