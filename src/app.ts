import express from 'express';
import cors from 'cors';
import path from 'path';
import roomRoutes from './routes/roomRoutes';

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/rooms', roomRoutes);

// Serve the room creation page
app.get('/create-room', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/create-room.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3007;

app.listen(PORT, () => {
    console.log(`Flooring service running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT}/create-room to create a room`);
});

export default app;