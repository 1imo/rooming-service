import { Router } from 'express';
import { RoomRepository } from '../repositories/RoomRepository';
import { serviceAuth } from '../middleware/serviceAuth';
import { pool } from '../config/database';
import { Point } from '../types/room';

const router = Router();
const roomRepository = new RoomRepository(pool);

/**
 * Create a new room
 * @route POST /api/rooms
 */
router.post('/', serviceAuth(), async (req, res) => {
    try {
        const {
            name,
            customer_id,
            company_id,
            points,
            notes,
            floor_type
        } = req.body;

        console.log(req.body);

        // Validate required fields
        if (!name || !customer_id || !company_id || !points || !Array.isArray(points)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate points structure
        if (!points.every(p => typeof p.x === 'number' && typeof p.y === 'number')) {
            return res.status(400).json({ error: 'Invalid points format' });
        }

        const room = await roomRepository.createRoom(
            name,
            customer_id,
            company_id,
            points,
            notes,
            floor_type
        );

        res.status(201).json(room);
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({ error: 'Failed to create room' });
    }
});

/**
 * Update a room
 * @route PUT /api/rooms/:id
 */
router.put('/:id', serviceAuth(), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, points, notes, floor_type } = req.body;

        if (points && !Array.isArray(points)) {
            return res.status(400).json({ error: 'Invalid points format' });
        }

        const room = await roomRepository.updateRoom(id, {
            name,
            points,
            notes,
            floor_type
        });

        res.json(room);
    } catch (error) {
        console.error('Error updating room:', error);
        res.status(500).json({ error: 'Failed to update room' });
    }
});

/**
 * Get a room by ID
 * @route GET /api/rooms/:id
 */
router.get('/:id', serviceAuth(), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const room = await roomRepository.getRoomById(id);

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        res.json(room);
    } catch (error) {
        console.error('Error fetching room:', error);
        res.status(500).json({ error: 'Failed to fetch room' });
    }
});

/**
 * Get all rooms for a customer
 * @route GET /api/rooms/customer/:customerId
 */
router.get('/customer/:customerId', serviceAuth(), async (req, res) => {
    try {
        const rooms = await roomRepository.getRoomsByCustomer(req.params.customerId);
        res.json(rooms);
    } catch (error) {
        console.error('Error fetching customer rooms:', error);
        res.status(500).json({ error: 'Failed to fetch customer rooms' });
    }
});

/**
 * Delete a room
 * @route DELETE /api/rooms/:id
 */
router.delete('/:id', serviceAuth(), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await roomRepository.deleteRoom(id);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting room:', error);
        res.status(500).json({ error: 'Failed to delete room' });
    }
});

/**
 * Save floorplan rooms
 * @route POST /api/rooms/floorplan
 */
router.post('/floorplan', serviceAuth(), async (req, res) => {
    try {
        const { rooms, companyId, customerId } = req.body;
        
        // Debug logging
        console.log('Received request body:', req.body);
        console.log('Extracted values:', { rooms, companyId, customerId });

        // Validate required fields
        if (!rooms || !Array.isArray(rooms) || !companyId || !customerId) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                debug: {
                    hasRooms: !!rooms,
                    isArray: Array.isArray(rooms),
                    hasCompanyId: !!companyId,
                    hasCustomerId: !!customerId
                }
            });
        }

        // Validate each room has required fields
        for (const room of rooms) {
            if (!room.name || !room.points || !Array.isArray(room.points)) {
                return res.status(400).json({ 
                    error: 'Each room must have a name and points',
                    debug: {
                        roomName: room.name,
                        hasPoints: !!room.points,
                        pointsIsArray: Array.isArray(room.points)
                    }
                });
            }
        }

        // Get existing rooms for this customer
        const existingRooms = await roomRepository.getRoomsByCustomer(customerId);
        
        // Create maps for easier lookup
        const existingRoomMap = new Map(existingRooms.map(room => [room.name, room]));
        const newRoomMap = new Map(rooms.map(room => [room.name, room]));

        // Arrays to track operations
        const roomsToCreate = [];
        const roomsToUpdate = [];
        const roomsToDelete = [];

        // Find rooms to create or update
        for (const [name, room] of newRoomMap) {
            const existingRoom = existingRoomMap.get(name);
            if (existingRoom) {
                // Room exists - update it
                roomsToUpdate.push({
                    ...room,
                    id: existingRoom.id
                });
            } else {
                // New room - create it
                roomsToCreate.push(room);
            }
        }

        // Find rooms to delete (rooms that exist but weren't in the new data)
        for (const [name, room] of existingRoomMap) {
            if (!newRoomMap.has(name)) {
                roomsToDelete.push(room);
            }
        }

        // Perform all operations
        const results = await Promise.all([
            // Delete rooms
            ...roomsToDelete.map(room => 
                roomRepository.deleteRoom(room.id)
            ),
            
            // Update rooms
            ...roomsToUpdate.map(room => 
                roomRepository.updateRoom(room.id, {
                    name: room.name,
                    points: room.points,
                    notes: room.notes || '',
                    floor_type: room.floor_type || 'default'
                })
            ),
            
            // Create new rooms
            ...roomsToCreate.map(room => 
                roomRepository.createRoom(
                    room.name,
                    customerId,
                    companyId,
                    room.points,
                    room.notes || '',
                    room.floor_type || 'default'
                )
            )
        ]);

        // Get final state of all rooms
        const updatedRooms = await roomRepository.getRoomsByCustomer(customerId);
        
        res.status(200).json({
            message: 'Floorplan saved successfully',
            rooms: updatedRooms,
            operations: {
                created: roomsToCreate.length,
                updated: roomsToUpdate.length,
                deleted: roomsToDelete.length
            }
        });

    } catch (error) {
        console.error('Error saving floorplan:', error);
        res.status(500).json({ error: 'Failed to save floorplan' });
    }
});

export default router;