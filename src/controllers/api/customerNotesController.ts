import { Request, Response } from 'express';

/**
 * Controller to handle customer note updates from frontend
 * This endpoint receives the convert_cid UUID from the frontend script
 * and stores it in Firestore for later retrieval
 */
export const handleCustomerNoteUpdate = async (req: Request, res: Response) => {
    try {
        const { customer_note } = req.body;

        if (!customer_note) {
            return res.status(400).json({ error: 'customer_note is required' });
        }

        // Extract convertVisitorId from customer_note (format: convert_cid:UUID)
        const cidMatch = customer_note.match(/convert_cid:([^\s]+)/);
        if (!cidMatch || !cidMatch[1]) {
            return res.status(400).json({ error: 'Invalid convert_cid format' });
        }

        const convertVisitorId = cidMatch[1];

        console.log(`[CUSTOMER-NOTES] Received customer_note: "${customer_note}"`);
        console.log(`[CUSTOMER-NOTES] Extracted convertVisitorId: ${convertVisitorId}`);

        // Store the customer_note in Firestore using convertVisitorId as document ID
        const { saveContext } = require('../../services/firestore-service');
        const context = {
            convertVisitorId,
            customerNote: customer_note,
            timestamp: Date.now(),
            source: 'customer-note-update'
        };

        await saveContext(convertVisitorId, context);

        console.log(`[CUSTOMER-NOTES] Context saved to Firestore for convertVisitorId: ${convertVisitorId}`);

        res.json({
            success: true,
            message: 'Customer note updated successfully',
            convertVisitorId
        });
    } catch (error: any) {
        console.error('[CUSTOMER-NOTES] Error updating customer note:', error);
        res.status(500).json({ error: error.message });
    }
};
