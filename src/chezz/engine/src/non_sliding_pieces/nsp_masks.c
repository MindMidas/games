#include "nsp.h"


/*
 * Gen pseudo-legal moves for peon based on direction.
 * square: Starting square index (0-63).
 * direction: 1 for White (up), -1 for Black (down).
 * Returns bitboard with bits set (for forward & diagonal capture moves).
 */
Bitboard gen_peon_mask(int square, int direction) {
    Bitboard moves = 0;

    // compute the peon's col and row
    int col = square % 8;
    int row = square / 8;

    // move forward one
    int forward_square = square + (direction * 8);

    // ensure move stays within board limits
    if (forward_square >= 0 && forward_square < TOTAL_SQUARES) {
        // set bit for forward move
        moves |= (1ULL << forward_square);
    }

    // diagonal captures (left and right), dx = -1 (left), dx = 1 (right)
    for (int dx = -1; dx <= 1; dx += 2) { 

        // compute the new diagonal square
        int capture_col = col + dx;
        int capture_row = row + direction;
        char square_str[3] = { 'a' + capture_col, '1' + capture_row, '\0' };
        int capture_square = square_to_index(square_str);

        // ensure move stays within board limits, using row and col to prevent wrap around
        if (capture_col >= 0 && capture_col < 8 && capture_row >= 0 && capture_row < 8) {
            
            // set bit for capture move and preserve other bits
            moves |= (1ULL << capture_square);
        }
    }

    return moves;
}


/*
 * Fen pseudo-legal moves for a knight.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for L-shaped knight moves).
 */
Bitboard gen_knight_mask(int square) {
    Bitboard moves = 0;

    // compute the knight's col and row
    int col = square % 8;  // col (a-h → 0-7)
    int row = square / 8;  // row (1-8 → 0-7)

    // 8 possible L-shaped moves (row change, col change)
    int knight_moves[8][2] = {
        {-2, -1}, {-2, +1},
        {-1, -2}, {+1, -2},
        {-1, +2}, {+1, +2},
        {+2, -1}, {+2, +1} 
    };

    // iterate over all possible moves
    for (int i = 0; i < 8; i++) {
        int new_row = row + knight_moves[i][0];
        int new_col = col + knight_moves[i][1];

        // ensure the new position is within board limits
        if (new_row >= 0 && new_row < 8 && new_col >= 0 && new_col < 8) {

            // convert to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for valid knight move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal moves for a king.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for one-square king moves).
 */
Bitboard gen_king_mask(int square) {
    Bitboard moves = 0;

    // compute king's col and row
    int col = square % 8;
    int row = square / 8;

    // 8 possible king moves
    int king_moves[8][2] = {
        {0, 1},
        {1, 1},
        {1, 0},
        {1, -1},
        {0, -1},
        {-1, -1},
        {-1, 0},
        {-1, 1}
    };

    // iterate over all possible moves
    for (int i = 0; i < 8; i++) {
        int new_row = row + king_moves[i][0];
        int new_col = col + king_moves[i][1];

        // ensure the new position is within board limits
        if (new_row >= 0 && new_row < 8 && new_col >= 0 && new_col < 8) {
            
            // convert to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for valid king move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal moves for a zombie.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for zombie moves).
 */
Bitboard gen_zombie_mask(int square) {
    Bitboard moves = 0;

    // compute zombie's col and row
    int col = square % 8;
    int row = square / 8;

    // 4 possible zombie moves
    int zombie_moves[4][2] = {
        {0, 1},
        {1, 0},
        {0, -1},
        {-1, 0}
    };

    // iterate over all possible moves
    for (int i = 0; i < 4; i++) {
        int new_row = row + zombie_moves[i][0];
        int new_col = col + zombie_moves[i][1];

        // ensure the new position is within board limits
        if (new_row >= 0 && new_row < 8 && new_col >= 0 && new_col < 8) {
            
            // convert to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for valid zombie move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal moves for a catapult.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for one-square catapult moves, same as king).
 */
Bitboard gen_catapult_mask(int square) {
    Bitboard moves = 0;

    // compute catapult's col and row
    int col = square % 8;
    int row = square / 8;

    // 8 possible moves (same as king)
    int catapult_moves[8][2] = {
        {0, 1},
        {1, 1},
        {1, 0},
        {1, -1},
        {0, -1},
        {-1, -1},
        {-1, 0},
        {-1, 1}
    };

    // iterate over all possible moves
    for (int i = 0; i < 8; i++) {
        int new_row = row + catapult_moves[i][0];
        int new_col = col + catapult_moves[i][1];

        // ensure move is within board limits
        if (new_row >= 0 && new_row < 8 && new_col >= 0 && new_col < 8) {
            
            // convert to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for valid move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal moves for a canon.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for canon moves).
 */
Bitboard gen_canon_mask(int square) {
    Bitboard moves = 0;

    // compute canon's col and row
    int col = square % 8;
    int row = square / 8;

    // 4 possible moves 
    int canon_moves[4][2] = {
        {0, 1},
        {1, 0},
        {0, -1},
        {-1, 0}
    };

    // iterate over all possible moves
    for (int i = 0; i < 4; i++) {
        int new_row = row + canon_moves[i][0];
        int new_col = col + canon_moves[i][1];

        // ensure move is within board limits
        if (new_row >= 0 && new_row < 8 && new_col >= 0 && new_col < 8) {
            
            // convert to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for valid move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}

