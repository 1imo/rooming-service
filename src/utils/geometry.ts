import { Point } from '../types/room';

export class GeometryCalculator {
    /**
     * Calculate the area of a polygon using the Shoelace formula
     */
    static calculateArea(points: Point[]): number {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return Math.abs(area) / 2;
    }

    /**
     * Calculate the perimeter of a polygon
     */
    static calculatePerimeter(points: Point[]): number {
        let perimeter = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            const dx = points[j].x - points[i].x;
            const dy = points[j].y - points[i].y;
            perimeter += Math.sqrt(dx * dx + dy * dy);
        }
        return perimeter;
    }

    /**
     * Calculate carpet measurements with overlap
     * Adds 10cm overlap for each edge for carpet area
     */
    static calculateCarpetMeasurements(points: Point[]): {
        carpetArea: number;
        carpetPerimeter: number;
    } {
        const OVERLAP = 0.1; // 10cm overlap
        
        // Add overlap to points
        const expandedPoints = points.map((point, i) => {
            const prev = points[(i - 1 + points.length) % points.length];
            const next = points[(i + 1) % points.length];
            
            // Calculate normal vector
            const dx1 = point.x - prev.x;
            const dy1 = point.y - prev.y;
            const dx2 = next.x - point.x;
            const dy2 = next.y - point.y;
            
            // Normalize and average the normal vectors
            const length1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const length2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            
            const nx1 = -dy1 / length1;
            const ny1 = dx1 / length1;
            const nx2 = -dy2 / length2;
            const ny2 = dx2 / length2;
            
            const nx = (nx1 + nx2) / 2;
            const ny = (ny1 + ny2) / 2;
            
            // Normalize the averaged normal vector
            const length = Math.sqrt(nx * nx + ny * ny);
            
            return {
                x: point.x + (nx / length) * OVERLAP,
                y: point.y + (ny / length) * OVERLAP
            };
        });

        return {
            carpetArea: this.calculateArea(expandedPoints),
            carpetPerimeter: this.calculatePerimeter(expandedPoints)
        };
    }
}