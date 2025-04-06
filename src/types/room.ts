export interface Point {
    x: number;
    y: number;
}

export interface RoomMeasurements {
    trueArea: number;        // Actual room area in square meters
    carpetArea: number;      // Required carpet area (slightly larger)
    truePerimeter: number;   // Actual room perimeter in meters
    carpetPerimeter: number; // Required carpet perimeter (slightly larger)
}

export interface Room {
    id?: number;
    name: string;
    customer_id: string;
    company_id: string;
    points: Point[];
    notes?: string;
    floor_type?: string;
    measurements: RoomMeasurements;
    created_at: Date;
    updated_at: Date;
}

export interface RoomUpdate {
    name?: string;
    points?: Point[];
    notes?: string;
    floor_type?: string;
    measurements?: RoomMeasurements;
}

export interface RoomWithMeasurements extends Room {
    measurements: RoomMeasurements;
}