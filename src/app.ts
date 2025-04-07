import express from 'express';
import cors from 'cors';
import path from 'path';
import roomRoutes from './routes/roomRoutes';
import { RoomRepository } from './repositories/RoomRepository';
import { pool } from './config/database';
import fs from 'fs/promises';
import Handlebars from 'handlebars';

interface Point {
    x: number;
    y: number;
}

interface Room {
    name: string;
    points: Point[];
}

interface Measurement {
    value: string;
    position: Point;
    angle: number;
}

interface Company {
    name: string;
    logo: string;
    website: string;
}

interface Customer {
    first_name: string;
    last_name: string;
    address_line1: string;
    address_line2?: string;
    city: string;
    county: string;
    postcode: string;
}

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

// Serve the floorplan template
app.get('/floorplan/:companyId/:customerId/:roomName?', async (req, res) => {
    try {
        const { companyId, customerId, roomName } = req.params;
        
        // Read the floorplan template
        const templatePath = path.join(__dirname, '../FLOORPLAN-TEMPLATE-PRINT/template.html');
        const template = await fs.readFile(templatePath, 'utf-8');
        
        // Compile the template
        const compiledTemplate = Handlebars.compile(template);
        
        // Fetch rooms for this customer
        const rooms = await roomRepository.getRoomsByCustomer(customerId);
        
        // Filter rooms if roomName is provided
        const filteredRooms = roomName 
            ? rooms.filter(r => r.name === roomName)
            : rooms;
            
        if (roomName && filteredRooms.length === 0) {
            return res.status(404).send('Room not found');
        }

        // Prepare room data for the template
        const roomsData = filteredRooms.map(room => {
            // Calculate center point for room label
            const center = calculateRoomCenter(room.points);
            
            // Calculate measurements
            const measurements = calculateMeasurements(room.points);
            
            return {
                name: room.name,
                path: pointsToSvgPath(room.points),
                center,
                measurements,
                area: room.measurements.trueArea.toFixed(2),
                perimeter: room.measurements.truePerimeter.toFixed(2),
                carpetArea: room.measurements.carpetArea.toFixed(2),
                carpetPerimeter: room.measurements.carpetPerimeter.toFixed(2)
            };
        });

        // Get company details (you'll need to implement this)
        const company = await getCompanyDetails(companyId);
        // Get customer details (you'll need to implement this)
        const customer = await getCustomerDetails(customerId);

        // Prepare the data for the template
        const data = {
            company,
            customer,
            rooms: roomsData,
            generated_date: new Date().toLocaleDateString(),
            current_year: new Date().getFullYear()
        };

        // Render the template
        const html = compiledTemplate(data);
        
        // Send the rendered HTML
        res.send(html);
    } catch (error) {
        console.error('Error generating floorplan:', error);
        res.status(500).send('Error generating floorplan');
    }
});

// Helper function to convert points to SVG path
function pointsToSvgPath(points: Point[]): string {
    if (!points || points.length < 2) return '';
    
    const commands = points.map((point: Point, index: number) => {
        // Scale points to fit SVG viewport (assuming 100x100 viewport)
        const x = point.x * 100;
        const y = point.y * 100;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
    });
    
    // Close the path
    commands.push('Z');
    
    return commands.join(' ');
}

// Helper function to calculate polygon area using the Shoelace formula
function calculateArea(points: Point[]): number {
    if (!points || points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    
    return Math.abs(area) / 2;
}

// Helper function to calculate perimeter
function calculatePerimeter(points: Point[]): number {
    if (!points || points.length < 2) return 0;
    
    let perimeter = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
    }
    
    return perimeter;
}

// Helper function to calculate room center
function calculateRoomCenter(points: Point[]): Point {
    if (!points || points.length === 0) return { x: 50, y: 50 };
    
    const sum = points.reduce((acc: Point, point: Point) => ({
        x: acc.x + point.x,
        y: acc.y + point.y
    }), { x: 0, y: 0 });
    
    return {
        x: (sum.x / points.length) * 100, // Convert to percentage
        y: (sum.y / points.length) * 100  // Convert to percentage
    };
}

// Helper function to calculate measurements
function calculateMeasurements(points: Point[]): Measurement[] {
    if (!points || points.length < 2) return [];
    
    const measurements: Measurement[] = [];
    
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        
        // Calculate length
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate midpoint
        const midpoint = {
            x: ((p1.x + p2.x) / 2) * 100, // Convert to percentage
            y: ((p1.y + p2.y) / 2) * 100  // Convert to percentage
        };
        
        // Calculate angle
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        measurements.push({
            value: length.toFixed(2),
            position: midpoint,
            angle: angle
        });
    }
    
    return measurements;
}

// Helper function to get company details (implement this)
async function getCompanyDetails(companyId: string): Promise<Company> {
    // TODO: Implement company details fetching
    return {
        name: "Company Name",
        logo: "/path/to/logo.png",
        website: "www.company.com"
    };
}

// Helper function to get customer details (implement this)
async function getCustomerDetails(customerId: string): Promise<Customer> {
    // TODO: Implement customer details fetching
    return {
        first_name: "John",
        last_name: "Doe",
        address_line1: "123 Main St",
        address_line2: "Apt 4B",
        city: "London",
        county: "Greater London",
        postcode: "SW1A 1AA"
    };
}

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

// Serve the room view page
app.get('/rooms/:companyId/:customerId/:roomName', async (req, res) => {
    try {
        const { companyId, customerId, roomName } = req.params;
        
        // Read the HTML template
        let html = await fs.readFile(path.join(__dirname, '../public/view-room.html'), 'utf-8');
        
        try {
            // Fetch rooms for this customer
            const rooms = await roomRepository.getRoomsByCustomer(customerId);
            const room = rooms.find(r => r.name === roomName);
            
            if (!room) {
                return res.status(404).send('Room not found');
            }
            
            // Inject the room data
            const roomScript = `
                <script>
                    window.room = ${JSON.stringify(room)};
                    window.isViewOnly = true;
                </script>
            `;
            html = html.replace('</head>', `${roomScript}</head>`);
            
            // Send the HTML
            res.send(html);
        } catch (dbError) {
            console.error('Database error:', dbError);
            res.status(500).send('Error loading room');
        }
    } catch (error) {
        console.error('Error preparing room view page:', error);
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