#include "peon_struct_eval.h"

/*
 * Evaluate peon structure for Chezzboard move.
 * board: Ptr to the Chezzboard to evaluate.
 * color: 1 for white, -1 for black.
 * Returns int score relative to the side to move (positive favors the current player).
 */
int peon_structure_score(const Chezzboard *board, int color) {

    /* 1. Initialization */
    int white_score = 0;
    int black_score = 0;
    Bitboard center_mask = 0x0000001818000000ULL;
    Bitboard white_peons = board->pieces[WP];
    Bitboard black_peons = board->pieces[BP];


    /* 2. Evaluate white peons */
    if (white_peons) {

        // get friendly neighbors 
        Bitboard left_friendly = (white_peons & ~COL_A) >> 1;
        Bitboard right_friendly = (white_peons & ~COL_H) << 1;
        Bitboard up_friendly = white_peons << 8;
        Bitboard down_friendly = white_peons >> 8;
        Bitboard up_left_friendly = (white_peons & ~COL_A & ~row_masks[7]) >> 9;
        Bitboard up_right_friendly = (white_peons & ~COL_H & ~row_masks[7]) >> 7;
        Bitboard down_left_friendly = (white_peons & ~COL_A & ~row_masks[0]) << 7;
        Bitboard down_right_friendly = (white_peons & ~COL_H & ~row_masks[0]) << 9;


        /* 3. White score rewards */
        // (1) Reward: for each peon with a neighbor
        Bitboard connected = white_peons & (left_friendly | right_friendly | up_friendly | down_friendly | 
                                            up_left_friendly | up_right_friendly | down_left_friendly | down_right_friendly);
        white_score += PEON_HAS_NEIGHBOR * __builtin_popcountll(connected);;

        // (2) Reward: peons protectiing friendly peons forward (scores chains higher)
        Bitboard diagonal_connected = white_peons & (up_left_friendly | up_right_friendly);
        white_score += PEON_COVERING_PEON * __builtin_popcountll(diagonal_connected);

        // (3) Reward: peons on higher rows (to increase chance of turning into a zombie)
        for (int row = 0; row < 8; row++) {

            int count = __builtin_popcountll(white_peons & row_masks[row]);

            white_score += PEON_HIGH_ROW * row * count;
        }

        // (4) Reward: Peons controlling center board squares
        white_score += PEON_DOMINANCE * __builtin_popcountll(white_peons & center_mask);

        // (5) Reward: Passed peons (clear path to zombie promotion)
        // iterate over all peons checking if it's passed
        Bitboard wp = white_peons;
        while (wp) {
            // pop LSB
            int square = __builtin_ctzll(wp);
            wp &= wp - 1;

            // get square
            int row = square / 8;
            int col = square % 8;

            // gen blocking mask for squares in front of white peon (up)
            Bitboard blocking_mask = 0;
            for (int r = row + 1; r < 8; r++) {
                // add square in the same col
                blocking_mask |= (col_masks[col] & row_masks[r]);

                // add square in left adjacent col if available
                if (col > 0)
                    blocking_mask |= (col_masks[col - 1] & row_masks[r]);

                // add square in right adjacent col if available
                if (col < 7)
                    blocking_mask |= (col_masks[col + 1] & row_masks[r]);
            }

            // check if black peon is in blocking mask
            if ((blocking_mask & black_peons) == 0) {
                white_score += PASSED_PEONS * row;
            }
        }
        

        /* 4. White score penalties */
         // (1) Penalty: peons in same col (we don't want over-crowded cols)
        for (int col = 0; col < 8; col++) {

            Bitboard col_peons = white_peons & col_masks[col];
            int count = __builtin_popcountll(col_peons);

            if (count > 1) {
                white_score -= PEON_SAME_COL * (count - 1);
            }
        }

        // (2) Penalty: peons without friendly neighbors (unprotected)
        Bitboard isolated = white_peons & ~(left_friendly | right_friendly | up_friendly | down_friendly | 
                    up_left_friendly | up_right_friendly | down_left_friendly | down_right_friendly);
        white_score -= LONELY_PEON * __builtin_popcountll(isolated);
        
        // (3) Penalty: backward peons -> any white peon that is not in the support mask is backward
        Bitboard lower_white = white_peons & ~row_masks[0];
        Bitboard support_mask = (((lower_white & ~COL_A) << 7) | ((lower_white & ~COL_H) << 9));
        Bitboard backward_peons = white_peons & ~support_mask;
        
        // scale score to avoid penalizing backward peons that are already high up
        while (backward_peons) {
            int square = __builtin_ctzll(backward_peons);
            backward_peons &= backward_peons - 1;
            int row = square / 8;
            float penalty_factor = (row >= 4) ? 0.5f : 1.0f;
            white_score -= (int)(BACKWARDS_PEON * penalty_factor);
        }

        // (4) Penalty: peon islands (increases fragmentation, harder to defend)
        // create 8 bit mask, where each bit represents a col
        unsigned int white_island_mask = 0;
        for (int col = 0; col < 8; col++) {
            if (white_peons & col_masks[col])
                white_island_mask |= (1 << col);
        }
        
        // count num islands by checking contiguous groups of 1's in the mask
        int white_island_count = 0;
        bool inIsland = false;
        for (int col = 0; col < 8; col++) {

            // island found since peon in this col
            if (white_island_mask & (1 << col)) {
                
                if (!inIsland) {
                    white_island_count++;
                    inIsland = true;
                }
            } else {
                // end the current island
                inIsland = false;
            }
        }
        
        // only penalize for extra islands beyond first
        if (white_island_count > 1) {
            white_score -= PEON_ISLAND * (white_island_count - 1);
        }

    }
    

    /* 5. Evaluate black peons */
    if (black_peons) {

        // get friendly neighbors 
        Bitboard left_friendly = (black_peons & ~COL_A) >> 1;
        Bitboard right_friendly = (black_peons & ~COL_H) << 1;
        Bitboard up_friendly = black_peons << 8;
        Bitboard down_friendly = black_peons >> 8;
        Bitboard up_left_friendly = (black_peons & ~COL_A & ~row_masks[7]) >> 9;
        Bitboard up_right_friendly = (black_peons & ~COL_H & ~row_masks[7]) >> 7;
        Bitboard down_left_friendly = (black_peons & ~COL_A & ~row_masks[0]) << 7;
        Bitboard down_right_friendly = (black_peons & ~COL_H & ~row_masks[0]) << 9;
        

        /* 6. Black score rewards */
        // (1) Reward: for each peon with a neighbor
        Bitboard connected = black_peons & (left_friendly | right_friendly | up_friendly | down_friendly | 
                                            up_left_friendly | up_right_friendly | down_left_friendly | down_right_friendly);
        black_score += PEON_HAS_NEIGHBOR * __builtin_popcountll(connected);
        
        // (2) Reward: peons protectiing friendly peons forward (scores chains higher)
        Bitboard diagonal_connected = black_peons & (down_left_friendly | down_right_friendly);
        black_score += PEON_COVERING_PEON * __builtin_popcountll(diagonal_connected);
        
        // (3) Reward: peons on lower rows (to increase chance of turning into a zombie)
        for (int row = 0; row < 8; row++) {

            int count = __builtin_popcountll(black_peons & row_masks[row]);

            black_score += PEON_HIGH_ROW * (7 - row) * count;
        }

        // (4) Reward: Peons controlling center board squares
        black_score += PEON_DOMINANCE * __builtin_popcountll(black_peons & center_mask);
        
        // (5) Reward: Passed peons (clear path to zombie promotion)
        // iterate over all peons checking if it's passed
        Bitboard bp = black_peons;
        while (bp) {
            // pop LSB
            int square = __builtin_ctzll(bp);
            bp &= bp - 1;
            
            // get square
            int row = square / 8;
            int col = square % 8;
            
            // gen blocking mask for squares in front of black peon (down)
            Bitboard blocking_mask = 0;
            for (int r = row - 1; r >= 0; r--) {
                // add square in the same col
                blocking_mask |= (col_masks[col] & row_masks[r]);
                
                // add square in left adjacent col if available
                if (col > 0)
                    blocking_mask |= (col_masks[col - 1] & row_masks[r]);
                
                // add square in right adjacent col if available
                if (col < 7)
                    blocking_mask |= (col_masks[col + 1] & row_masks[r]);
            }
            
            // check if white peon is in blocking mask
            if ((blocking_mask & white_peons) == 0) {
                black_score += PASSED_PEONS * (7 - row);
            }
        }


        /* 7. Black score penalties */
        // (1) Penalty: peons in same col (we don't want over-crowded cols, doubled peons)
        for (int col = 0; col < 8; col++) {

            Bitboard col_peons = black_peons & col_masks[col];
            int count = __builtin_popcountll(col_peons);

            if (count > 1) {
                black_score -= PEON_SAME_COL * (count - 1);
            }
        }

        // (2) Penalty: peons without friendly neighbors (unprotected)
        Bitboard isolated = black_peons & ~(left_friendly | right_friendly | up_friendly | down_friendly | 
                    up_left_friendly | up_right_friendly | down_left_friendly | down_right_friendly);
        black_score -= LONELY_PEON * __builtin_popcountll(isolated);

        // (3) Penalty: backward peons -> any black peon that is not in the support mask is backward
        Bitboard higher_black = black_peons & ~row_masks[7];
        Bitboard support_mask = (((higher_black & ~COL_A) >> 9) | ((higher_black & ~COL_H) >> 7));
        Bitboard backward_peons = black_peons & ~support_mask;
        
        // scale score to avoid penalizing backward peons that are already down low
        while (backward_peons) {
            int square = __builtin_ctzll(backward_peons);
            backward_peons &= backward_peons - 1;
            int row = square / 8;
            float penalty_factor = (row >= 4) ? 1.0f : 0.5f;
            black_score -= (int)(BACKWARDS_PEON * penalty_factor);
        }

        // (4) Penalty: peon islands (increases fragmentation, harder to defend)
        // create 8 bit mask, where each bit represents a col
        unsigned int black_island_mask = 0;
        for (int col = 0; col < 8; col++) {
            if (black_peons & col_masks[col])
                black_island_mask |= (1 << col);
        }
        
        // count num islands by checking contiguous groups of 1's in the mask
        int black_island_count = 0;
        bool inIsland = false;
        for (int col = 0; col < 8; col++) {

            // island found since peon in this col
            if (black_island_mask & (1 << col)) {

                if (!inIsland) {
                    black_island_count++;
                    inIsland = true;
                }
            } 
            
            else {
                // end the current island
                inIsland = false;
            }
        }
        
        // only penalize for extra islands beyond first
        if (black_island_count > 1) {
            black_score -= PEON_ISLAND * (black_island_count - 1);
        }

    }
    
    return (white_score - black_score) * color;
}

