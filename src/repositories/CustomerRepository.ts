import { Pool } from 'pg';
import { pools } from '../config/database';

export interface Customer {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_line1: string;
    address_line2?: string;
    city: string;
    county: string;
    postcode: string;
    company_id: string;
    created_at: Date;
    updated_at: Date;
}

export class CustomerRepository {
    private readonly db: Pool;

    constructor() {
        this.db = pools.orders;
    }

    async findById(id: string, companyId: string): Promise<Customer | null> {
        const result = await this.db.query(
            `SELECT 
                id, first_name, last_name, email, phone,
                address_line1, address_line2, city, county,
                postcode, company_id, created_at, updated_at
            FROM customer 
            WHERE id = $1 AND company_id = $2`,
            [id, companyId]
        );
        return result.rows[0] || null;
    }
} 