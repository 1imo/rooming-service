import express from 'express';
import cors from 'cors';
import path from 'path';
import roomRoutes from './routes/roomRoutes';
import { RoomRepository } from './repositories/RoomRepository';
import { pool } from './config/database';
import fs from 'fs/promises';

const app = express();
const roomRepository = new RoomRepository(pool);

app.use(cors());
app.use(express.json());

// Add MIME type for JavaScript modules
app.use((req, res, next) => {
    if (req.url.endsWith('.js')) {
        res.type('application/javascript');
    }
    next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/rooms', roomRoutes);

// Serve the room creation page with company and customer IDs
app.get('/create-room/:companyId/:customerId', async (req, res) => {
    try {
        const { companyId, customerId } = req.params;
        
        // Read the HTML template
        let html = await fs.readFile(path.join(__dirname, '../public/create-room.html'), 'utf-8');
        
        try {
            // Fetch rooms for this customer
            const rooms = await roomRepository.getRoomsByCustomer(customerId);
            
            // Only inject the rooms data if there are rooms
            if (rooms && rooms.length > 0) {
                const roomsScript = `
                    <script>
                        window.existingRooms = ${JSON.stringify(rooms)};
                        window.companyId = "${companyId}";
                        window.customerId = "${customerId}";
                    </script>
                `;
                html = html.replace('</head>', `${roomsScript}</head>`);
            } else {
                // Just inject the IDs if no rooms exist
                const roomsScript = `
                    <script>
                        window.companyId = "${companyId}";
                        window.customerId = "${customerId}";
                    </script>
                `;
                html = html.replace('</head>', `${roomsScript}</head>`);
            }
        } catch (dbError) {
            console.error('Database error:', dbError);
            // If database query fails, still show the blank page with IDs
            const roomsScript = `
                <script>
                    window.companyId = "${companyId}";
                    window.customerId = "${customerId}";
                </script>
            `;
            html = html.replace('</head>', `${roomsScript}</head>`);
        }
        
        // Send the HTML
        res.send(html);
    } catch (error) {
        console.error('Error preparing room creation page:', error);
        res.status(500).send('Error loading page');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3011;

app.listen(PORT, () => {
    console.log(`Flooring service running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT}/create-room to create a room`);
});

export default app;