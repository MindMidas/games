#include "king_safety_eval.h"
#include "nsp.h"
#include "sp.h"
#include "material_eval.h"

/*
 * Check if the king of color is in check (direct threat!).
 * board: Ptr to the current Chezzboard.
 * color: Color of curr player (1 for white, -1 for black).
 * Returns 1 if the king is in check, 0 otherwise.
 */
int is_king_in_check(const Chezzboard *board, int color) {

    /* 1. Initialization */
    
    // get friendly king
    Bitboard king = (color == 1) ? board->pieces[WK] : board->pieces[BK];

    // get enemy pieces
    Bitboard enemy_king = (color == -1) ? board->pieces[WK] : board->pieces[BK];
    Bitboard enemy_peons = (color == -1) ? board->pieces[WP] : board->pieces[BP];
    Bitboard enemy_canon = (color == -1) ? board->pieces[WC] : board->pieces[BC];
    Bitboard enemy_knights = (color == -1) ? board->pieces[WN] : board->pieces[BN];
    Bitboard enemy_bishop = (color == -1) ? board->pieces[WB] : board->pieces[BB];
    Bitboard enemy_rook = (color == -1) ? board->pieces[WR] : board->pieces[BR];
    Bitboard enemy_queen = (color == -1) ? board->pieces[WQ] : board->pieces[BQ];
    Bitboard enemy_zombies = (color == -1) ? board->pieces[WZ] : board->pieces[BZ];


    /* 2. Check if king is in check */

     // (1) Direct diagonal threat from enemy canon
     if (enemy_canon) {
        int sq = __builtin_ctzll(enemy_canon);

        // canon shot is bishop attack
        Bitboard attack_path = bishop_attacks(sq, 0ULL);

        // check if white king is in attack path
        if (attack_path & king) {
            return true;
        }
    }

    // (2) Direct threat from enemy knight
    while (enemy_knights) {
        
        int sq = __builtin_ctzll(enemy_knights);
        enemy_knights &= enemy_knights - 1;

        // use precomputed pseudo-legal moves for knights 
        if (nsp_table[BN][sq] & king) {
            return true;
        }
    }

    // (3) Direct threat from enemy bishop
    if (enemy_bishop) {
        int sq = __builtin_ctzll(enemy_bishop);

        if (bishop_attacks(sq, board->all_pieces) & king) {
            return true;
        }
    }

    // (4) Direct threat from enemy rook
    if (enemy_rook) {
        int sq = __builtin_ctzll(enemy_rook);

        if (rook_attacks(sq, board->all_pieces) & king) {
            return true;
        }
    }

    // (5) Direct threat from enemy queen
    if (enemy_queen) {
        int sq = __builtin_ctzll(enemy_queen);

        if (queen_attacks(sq, board->all_pieces) & king) {
            return true;
        }
    }

    // (6) Direct threat from enemy zombie
    while (enemy_zombies) {

        int sq = __builtin_ctzll(enemy_zombies);
        enemy_zombies &= enemy_zombies - 1;

        // use precomputed pseudo-legal moves for zombies 
        if (nsp_table[WZ][sq] & king) {
            return true;
        }
    }


    // (6) Direct threat from enemy peons
    while (enemy_peons) {

        int sq = __builtin_ctzll(enemy_peons);
        enemy_peons &= enemy_peons - 1;
        
        Bitboard peon_attack_mask = (color == -1) ? (nsp_table[WP][sq] & ~(1ULL << (sq + 8))) : (nsp_table[BP][sq] & ~(1ULL << (sq - 8)));
        
        // use precomputed pseudo-legal moves for zombies 
        if (peon_attack_mask & king) {
            return true;
        }
    }


    // (5) Direct threat from enemy king
    if (enemy_king) {
        int sq = __builtin_ctzll(enemy_king);

        if (nsp_table[WK][sq] & king) {
            return true;
        }
    }

    return false;
}


/*
 * Function to check if the king of a given color is still alive on the board.
 * board: Ptr to Chezzboard struct representing the curr setup.
 * color: Color of curr player (1 for white, -1 for black).
 * Returns 1 if the king is alive, 0 if captured.
 */
int is_king_alive(const Chezzboard *board, int color) {

    // return 1 if king is alive, 0 if captured
    return ((color == 1) ? board->pieces[WK] : board->pieces[BK]) != 0;
}


/*
 * Eval king safety for both sides for chezzboard move/board.
 * board: Ptr to the Chezzboard move.
 * color: Color of curr player (1 for white, -1 for black).
 * Returns int score (positive favors the current player's turn).
 */
int king_safety_score(const Chezzboard *board, int color) {
    
    /* 1. Initialization */
    int white_king_score = 0;
    int black_king_score = 0;
    Bitboard white_king = board->pieces[WK];
    Bitboard black_king = board->pieces[BK];
    Bitboard white_peons = board->pieces[WP];
    Bitboard black_peons = board->pieces[BP];
    Bitboard white_zombies = board->pieces[WZ];
    Bitboard black_zombies = board->pieces[BZ];
    Bitboard white_canon = board->pieces[WC];
    Bitboard black_canon = board->pieces[BC];
    Bitboard white_knights = board->pieces[WN];
    Bitboard black_knights = board->pieces[BN];
    Bitboard white_bishop = board->pieces[WB];
    Bitboard black_bishop = board->pieces[BB];
    Bitboard white_rook = board->pieces[WR];
    Bitboard black_rook = board->pieces[BR];
    Bitboard white_queen = board->pieces[WQ];
    Bitboard black_queen = board->pieces[BQ];
    Bitboard white_flinger = board->pieces[WF];
    Bitboard black_flinger = board->pieces[BF];
    Bitboard white_pieces = board->white_pieces;
    Bitboard black_pieces = board->black_pieces;
    // Bitboard all_pieces = board->all_pieces;
    

    /* 2. Calculate white king safety score */
    if (white_king) {
        
        // pop LSB
        int wk_square = __builtin_ctzll(white_king);
        int wk_row = wk_square / 8;
        int wk_col = wk_square % 8;
        
        /* 3. Calculate penalties for white king score */
        // (1) Penalty: missing peons in king shield
        if (wk_row < 7) {
            
            // create shield mask for row
            Bitboard shield_row_mask = row_masks[wk_row + 1];
        
            // create range mask for left col
            Bitboard col_range_mask = 0;
            if (wk_col > 0) {
                col_range_mask |= col_masks[wk_col - 1];
            }
            
            // always add king col
            col_range_mask |= col_masks[wk_col];

            // create range mask for right col
            if (wk_col < 7) {
                col_range_mask |= col_masks[wk_col + 1];
            }
                
            // shield mask is intersection of row and column
            Bitboard king_shield_mask = shield_row_mask & col_range_mask;
        
            // num white peons and zombies in this mask
            int shield_peons = __builtin_popcountll((white_peons | white_zombies) & king_shield_mask);
            
            // num expected white peons in shield
            int expected_shield = __builtin_popcountll(king_shield_mask);

            white_king_score -= (expected_shield - shield_peons) * MISSING_PEON_KING_SHIELD;
        }
        

        // (2) Penalty: enemy pieces in king ring (3x3) is a threat
        // calc boundaries in front of white king
        int min_row = (wk_row - 2 < 0) ? 0 : wk_row - 2;
        int max_row = (wk_row + 2 > 7) ? 7 : wk_row + 2;
        int min_col = (wk_col - 2 < 0) ? 0 : wk_col - 2;
        int max_col = (wk_col + 2 > 7) ? 7 : wk_col + 2;

        // create rows space mask
        Bitboard rows_mask = 0;
        for (int r = min_row; r <= max_row; r++) {
            rows_mask |= row_masks[r];
        }

        // create cols space mask
        Bitboard cols_mask = 0;
        for (int c = min_col; c <= max_col; c++) {
            cols_mask |= col_masks[c];
        }

        // king mask -> intersection of row & column
        Bitboard king_ring_mask = rows_mask & cols_mask;

        // remove king from ring
        king_ring_mask &= ~black_king;
        int ring_penalty = 0;

        // add penalty for each enemy piece in ring
        Bitboard enemy_queens = king_ring_mask & black_queen;
        ring_penalty += ENEMY_QUEEN_IN_KING_RING * __builtin_popcountll(enemy_queens);
        Bitboard enemy_rooks = king_ring_mask & black_rook;
        ring_penalty += ENEMY_ROOK_IN_KING_RING * __builtin_popcountll(enemy_rooks);
        Bitboard enemy_bishops = king_ring_mask & black_bishop;
        ring_penalty += ENEMY_BISHOP_IN_KING_RING * __builtin_popcountll(enemy_bishops);
        Bitboard enemy_knights = king_ring_mask & black_knights;
        ring_penalty += ENEMY_KNIGHT_IN_KING_RING * __builtin_popcountll(enemy_knights);
        Bitboard enemy_zombies = king_ring_mask & black_zombies;
        ring_penalty += ENEMY_ZOMBIE_IN_KING_RING * __builtin_popcountll(enemy_zombies);
        Bitboard enemy_flingers = king_ring_mask & black_flinger;
        ring_penalty += ENEMY_FLINGER_IN_KING_RING * __builtin_popcountll(enemy_flingers);
        Bitboard enemy_canons = king_ring_mask & black_canon;
        ring_penalty += ENEMY_CANON_IN_KING_RING * __builtin_popcountll(enemy_canons);
        Bitboard enemy_peons = king_ring_mask & black_peons;

        // add penalty for each enemy peon in king ring
        while (enemy_peons) {

            int sq = __builtin_ctzll(enemy_peons);
            enemy_peons &= enemy_peons - 1;
            int r = sq / 8;
            int c = sq % 8;

            // only peons from coming from above are dangerous
            if (r > wk_row) {  
                int dr = r - wk_row;
                int dc = (c >= wk_col) ? (c - wk_col) : (wk_col - c);
                int dist_sq = dr * dr + dc * dc;

                if (dist_sq == 1) {
                    ring_penalty += ENEMY_PEON_KING_RING_MED;
                } else {
                    ring_penalty += ENEMY_PEON_KING_RING_LOW;
                }
            }
        }

        white_king_score -= ring_penalty;


        // (3) Penalty: king on open/semi-open cols
        Bitboard king_col = col_masks[wk_col] & ~white_king;;
        Bitboard pieces_on_col = king_col & white_pieces;

        // fully open col
        if (!pieces_on_col) {
            white_king_score -= KING_ON_OPEN_COL;
        } 
        // semi-open col
        else if (!((pieces_on_col << 8) & white_pieces)) {
            white_king_score -= KING_ON_SEMI_OPEN_COL;
        }
        
    }
    
    
    /* 2. Calculate black king safety score */
    if (black_king) {
        int bk_square = __builtin_ctzll(black_king);
        int bk_row = bk_square / 8;
        int bk_col = bk_square % 8;
        
        /* 3. Calculate penalties for black king score */
        // (1) Penalty: missing peons in king shield
        if (bk_row > 0) {

            // create shield mask for row
            Bitboard shield_row_mask = row_masks[bk_row - 1];

            // create range mask for left col
            Bitboard col_range_mask = 0;
            if (bk_col > 0) {
                col_range_mask |= col_masks[bk_col - 1];
            }

            // always add king col
            col_range_mask |= col_masks[bk_col];

            // create range mask for right col
            if (bk_col < 7) {
                col_range_mask |= col_masks[bk_col + 1];
            }

            // shield mask is intersection of row and column
            Bitboard king_shield_mask = shield_row_mask & col_range_mask;

            // num white peons and zombies in this mask
            int shield_peons = __builtin_popcountll((black_peons | black_zombies) & king_shield_mask);

            // num expected white peons in shield
            int expected_shield = __builtin_popcountll(king_shield_mask);

            black_king_score -= (expected_shield - shield_peons) * MISSING_PEON_KING_SHIELD;
        }


        // (2) Penalty: enemy pieces in king ring (3x3) is a threat
        // calc boundaries in front of black king
        int min_row = (bk_row - 2 < 0) ? 0 : bk_row - 2;
        int max_row = (bk_row + 2 > 7) ? 7 : bk_row + 2;
        int min_col = (bk_col - 2 < 0) ? 0 : bk_col - 2;
        int max_col = (bk_col + 2 > 7) ? 7 : bk_col + 2;

        // create rows space mask
        Bitboard rows_mask = 0;
        for (int r = min_row; r <= max_row; r++) {
            rows_mask |= row_masks[r];
        }

        // create cols space mask
        Bitboard cols_mask = 0;
        for (int c = min_col; c <= max_col; c++) {
            cols_mask |= col_masks[c];
        }

        // region mask -> intersection of row & column
        Bitboard king_ring_mask = rows_mask & cols_mask;
        
        // remove king from ring
        king_ring_mask &= ~black_king;

        int ring_penalty = 0;

        // add penalty for each enemy piece in ring
        Bitboard enemy_queens = king_ring_mask & white_queen;
        ring_penalty += ENEMY_QUEEN_IN_KING_RING * __builtin_popcountll(enemy_queens);
        Bitboard enemy_rooks = king_ring_mask & white_rook;
        ring_penalty += ENEMY_ROOK_IN_KING_RING * __builtin_popcountll(enemy_rooks);
        Bitboard enemy_bishops = king_ring_mask & white_bishop;
        ring_penalty += ENEMY_BISHOP_IN_KING_RING * __builtin_popcountll(enemy_bishops);
        Bitboard enemy_knights = king_ring_mask & white_knights;
        ring_penalty += ENEMY_KNIGHT_IN_KING_RING * __builtin_popcountll(enemy_knights);
        Bitboard enemy_zombies = king_ring_mask & white_zombies;
        ring_penalty += ENEMY_ZOMBIE_IN_KING_RING * __builtin_popcountll(enemy_zombies);
        Bitboard enemy_flingers = king_ring_mask & white_flinger;
        ring_penalty += ENEMY_FLINGER_IN_KING_RING * __builtin_popcountll(enemy_flingers);
        Bitboard enemy_canons = king_ring_mask & white_canon;
        ring_penalty += ENEMY_FLINGER_IN_KING_RING * __builtin_popcountll(enemy_canons);
        Bitboard enemy_peons = king_ring_mask & white_peons;


        // add penalty for each enemy peon in king ring
        while (enemy_peons) {
            int sq = __builtin_ctzll(enemy_peons);
            enemy_peons &= enemy_peons - 1;
            int r = sq / 8;
            int c = sq % 8;

            // only count peons coming from row 0
            if (r < bk_row) {
                int dr = bk_row - r;
                int dc = (bk_col >= c) ? (bk_col - c) : (c - bk_col);
                int dist_sq = dr * dr + dc * dc;

                if (dist_sq == 1) {
                    ring_penalty += ENEMY_PEON_KING_RING_MED;
                } else {
                    ring_penalty += ENEMY_PEON_KING_RING_LOW;
                }
            }
        }
        
        black_king_score -= ring_penalty;

        
        // (3) Penalty: king on open/semi-open cols
        Bitboard king_col = col_masks[bk_col] & ~black_king;
        Bitboard pieces_on_col = king_col & black_pieces;

        // fully open file
        if (!pieces_on_col) {
            black_king_score -= KING_ON_OPEN_COL;
        } 
        // semi-open file
        else if (!((pieces_on_col >> 8) & black_pieces)) {
            black_king_score -= KING_ON_SEMI_OPEN_COL;
        }

    }


    /* 1. Check if King is in check */
    if (white_king && is_king_in_check(board, 1)) white_king_score -= 650;
    if (black_king && is_king_in_check(board, -1)) black_king_score -= 650;

    // if (white_king && is_king_in_check(board, 1)) white_king_score -= 3600;
    // if (black_king && is_king_in_check(board, -1)) black_king_score -= 3600;

    
    return (white_king_score - black_king_score) * color;
}
