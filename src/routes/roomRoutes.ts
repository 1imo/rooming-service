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

export default router;