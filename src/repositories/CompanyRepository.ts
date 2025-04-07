import { Pool } from 'pg';
import { pools } from '../config/database';

export interface Company {
    id: string;
    name: string;
    logo: string;
    website: string;
    email: string;
    phone: string;
    address_line1: string;
    address_line2?: string;
    city: string;
    county: string;
    postcode: string;
    created_at: Date;
    updated_at: Date;
}

export class CompanyRepository {
    private readonly db: Pool;

    constructor() {
        this.db = pools.clients;
    }

    async findById(id: string): Promise<Company | null> {
        const result = await this.db.query(
            `SELECT 
                id, name, website,
                email, phone, address_line1, address_line2,
                city, county, postcode, created_at, updated_at
            FROM company 
            WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }
} 