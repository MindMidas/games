#include "sp.h"

/*
 * Gen pseudo-legal move mask for a bishop.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for diagonal moves, excluding edges).
 */
Bitboard gen_bishop_mask(int square) {
    Bitboard moves = 0;

    // compute bishop's row and col
    int col = square % 8;
    int row = square / 8;

    // bishop moves diagonally in 4 directions
    int directions[4][2] = {
        {1, 1},
        {-1, 1},
        {1, -1},
        {-1, -1}
    };

    // iterate over each diagonal direction
    for (int d = 0; d < 4; d++) {
        int dx = directions[d][0];
        int dy = directions[d][1];
        int new_col = col;
        int new_row = row;

        // move bishop in the diagonal direction until out of bounds
        while (1) {

            // increment pos by displacement
            new_col += dx;
            new_row += dy;

            // stop before edge because we want to generate blocker-relevant moves
            if (new_col <= 0 || new_col >= 7 || new_row <= 0 || new_row >= 7) {
                break;
            }

            // convert (row, col) to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for this valid bishop move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal move mask for a rook.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for horizontal and vertical moves, excluding edges).
 */
Bitboard gen_rook_mask(int square) {
    Bitboard moves = 0;

    // compute the rook's row and col
    int col = square % 8;
    int row = square / 8;

    // rook moves in 4 straight directions (up, down, left, right)
    int directions[4][2] = {
        {0, 1},
        {0, -1},
        {1, 0},
        {-1, 0}
    };

    // iterate over each direction
    for (int d = 0; d < 4; d++) {

        int dx = directions[d][0];
        int dy = directions[d][1];

        int new_col = col;
        int new_row = row;

        // move rook in the current direction until out of bounds
        while (1) {

            // increment pos by displacement
            new_col += dx;
            new_row += dy;

            // stop before edge because we want to generate blocker-relevant moves
            // going up/down check row
            if ((dy != 0) && (new_row <= 0 || new_row >= 7)) {
                break;
            }
            // going left/right check col
            if ((dx != 0) && (new_col <= 0 || new_col >= 7)) {
                break;
            }

            // convert (row, col) to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for this valid rook move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}


/*
 * Gen pseudo-legal move mask for a queen. Not needed since queen is rook + bishop.
 * square: Starting square index (0-63).
 * Returns bitboard with bits set (for diagonal, horizontal, and vertical moves).
 */
Bitboard gen_queen_mask(int square) {
    Bitboard moves = 0;

    // compute queen's row and col
    int col = square % 8;
    int row = square / 8;

    // queen moves in 8 directions (rook + bishop)
    int directions[8][2] = {
        {0, 1},
        {0, -1},
        {1, 0},
        {-1, 0},
        {1, 1},
        {-1, 1},
        {1, -1},
        {-1, -1}
    };

    // iterate over each direction
    for (int d = 0; d < 8; d++) {
        int dx = directions[d][0];
        int dy = directions[d][1];

        int new_col = col;
        int new_row = row;

        // move queen in the current direction until out of bounds
        while (1) {
            new_col += dx;
            new_row += dy;

            // stop when out of bounds
            if (new_col < 0 || new_col >= 8 || new_row < 0 || new_row >= 8) {
                break;
            }

            // convert (row, col) to bitboard index
            int new_square = new_row * 8 + new_col;

            // set bit for this valid queen move and preserve other bits
            moves |= (1ULL << new_square);
        }
    }

    return moves;
}

