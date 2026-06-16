#include "pos_eval.h"

/* Piece Square Tables (PSTs) */


// white peons: advanced, central control, with weight at enemy spawn higher
int PST_WP[TOTAL_SQUARES] = {
    0,  0,  0,  0,  0,  0,  0,  0,
    5,  5,  5,  5,  5,  5,  5,  5,
    5,  5,  7,  7,  7,  7,  5,  5,
    6,  6,  8,  8,  8,  8,  6,  6,
    7, 10, 10, 10, 10, 10, 10,  7,
   10, 10, 15, 15, 15, 15, 10, 10,
   10, 10, 15, 15, 15, 15, 10, 10,
   10, 10, 15, 15, 15, 15, 10, 10
};

// black peons: advanced, central control, with weight at enemy spawn higher
int PST_BP[TOTAL_SQUARES] = {
   10, 10, 15, 15, 15, 15, 10, 10,
   10, 10, 15, 15, 15, 15, 10, 10,
   10, 10, 15, 15, 15, 15, 10, 10,
    7, 10, 10, 10, 10, 10, 10,  7,
    6,  6,  8,  8,  8,  8,  6,  6,
    5,  5,  7,  7,  7,  7,  5,  5,
    5,  5,  5,  5,  5,  5,  5,  5,
    0,  0,  0,  0,  0,  0,  0,  0,
};

// white knight: wants center control and squares that can attack canon and flinger
int PST_WN[TOTAL_SQUARES] = {
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -40,  5, 10, 15, 15, 10,  5,-40,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30, 30, 10, 20, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
};

// black knight: wants center control and squares that can attack canon and flinger
int PST_BN[TOTAL_SQUARES] = {
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -30, 30, 10, 20, 15, 10,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -40,  5, 10, 15, 15, 10,  5,-40,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
};

// white bishop: wants center control for max attacking + protection
int PST_WB[TOTAL_SQUARES] = {
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0, 10,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  0, 10, 15, 15, 10,  0,-10,
   -10,  0, 10, 15, 15, 10,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
};

// black bishop: wants center control for max attacking + protection
int PST_BB[TOTAL_SQUARES] = {
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  0, 10, 15, 15, 10,  0,-10,
   -10,  0, 10, 15, 15, 10,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  0,  0,  0,  0,  0, 10,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
};

// white rook: strongest on open cols
int PST_WR[TOTAL_SQUARES] = {
    0,  0,  0,  5,  5,  0,  0,  0,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    5, 10, 10, 10, 10, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
};

// black rook: strongest on open cols
int PST_BR[TOTAL_SQUARES] = {
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0
};

// white queen: strongest in the middle and towards enemy territory
int PST_WQ[TOTAL_SQUARES] = {
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0,  0,
   -10,  5,  5,  5,  5,  5,  5,-10,
   -10,  0,  5,  0,  0,  5,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
};

// black queen: strongest in the middle and towards enemy territory
int PST_BQ[TOTAL_SQUARES] = {
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  5,  0,  0,  5,  0,-10,
   -10,  5,  5,  5,  5,  5,  5,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0,  0,
   -10,  0,  5,  5,  5,  5,  0,-10,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
};


// white king: strongest in back lanes but towards left side to avoid enemy canon
int PST_WK[TOTAL_SQUARES] = {
    25, 35, 15,  0,  0, 10, 30, 20,
    20, 20,  0,  0,  0,  0, 20, 20,
   -10,-20,-20,-20,-20,-20,-20,-10,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30
};

// black king: strongest in back lanes but towards left side to avoid enemy canon
int PST_BK[TOTAL_SQUARES] = {
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    25, 35, 15,  0,  0, 10, 30, 20
};


// white zombies: strongest at higher rows and in center
int PST_WZ[TOTAL_SQUARES] = {
    0,  0,  0,   0,   0,  0,  0,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0, 10, 15,  15,  15, 15, 10,  0,
    0, 10, 20,  20,  20, 20, 10,  0,
    0, 10, 10,  10,  10, 10, 10,  0,
    0,  0,  0,   0,   0,  0,  0,  0
};

// black zombies: strongest at higher rows and in center
int PST_BZ[TOTAL_SQUARES] = {
    0,  0,  0,   0,   0,  0,  0,  0,
    0, 10, 10,  10,  10, 10, 10,  0,
    0, 10, 20,  20,  20, 20, 10,  0,
    0, 10, 15,  15,  15, 15, 10,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0,  5,  5,   5,   5,  5,  5,  0,
    0,  0,  0,   0,   0,  0,  0,  0
};


// white flinger: strongest at lower rows and in the center to fling enemy spawn
int PST_WF[TOTAL_SQUARES] = {
    0,   0,   0,   0,   0,   0,   0,   0,
    0,  50,  20,  20,  20,  20,  50,   0,
    0,  15,  25,  35,  35,  25,  15,   0,
    0,   5,  10,  15,  15,  10,   5,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0
};

// black flinger: strongest at higher rows and in the center to fling enemy spawn
int PST_BF[TOTAL_SQUARES] = {
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   0,   0,   0,   0,   0,   0,   0,
    0,   5,  10,  15,  15,  10,   5,   0,
    0,  15,  25,  35,  35,  25,  15,   0,
    0,  50,  20,  20,  20,  20,  50,   0,
    0,   0,   0,   0,   0,   0,   0,   0
};


// white cannons: 2nd row is good to defend, a4 and other angles to take out king is key (end columns)
int PST_WC[TOTAL_SQUARES] = {
   15,  5,  5,  5,  5,  5,  5, 15,
   15, 15, 10, 10, 10, 10, 15, 15,
   20, 10,  5,  5,  5,  5, 10, 20,
  100,  5,  5,  5,  5,  5,  5,100,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0
};

// black cannons: 7th row is good to defend, a5 and other angles to take out king is key (end columns)
int PST_BC[TOTAL_SQUARES] = {
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
  100,  5,  5,  5,  5,  5,  5,100,
   20, 10,  5,  5,  5,  5, 10, 20,
   15, 15, 10, 10, 10, 10, 15, 15,
   15,  5,  5,  5,  5,  5,  5, 15
};



/*
 * Calculate the positional eval score from PSTs for a Chezzboard move/board.
 * board: Ptr to the Chezzboard move/board to eval.
 * color: 1 for white, -1 for black.
 * Returns int score (positive favors the current player's turn).
 */
int pos_score(const Chezzboard *board, int color) {

    /* 1. Initialization */
    int white_score = 0;
    int black_score = 0;
    Bitboard curr_piece;
    int square;


    /* 2. Calculate white and black score */
    // iterate over all piece types
    for (int piece = 0; piece < TOTAL_TYPES; piece++) {
        curr_piece = board->pieces[piece];
        while (curr_piece) {
            // get LSB
            square = __builtin_ctzll(curr_piece);
            curr_piece &= curr_piece - 1;

            // add score for piece pos on the board
            switch (piece) {
                case WP: white_score += PST_WP[square]; break;
                case BP: black_score += PST_BP[square]; break;
                case WN: white_score += PST_WN[square]; break;
                case BN: black_score += PST_BN[square]; break;
                case WB: white_score += PST_WB[square]; break;
                case BB: black_score += PST_BB[square]; break;
                case WR: white_score += PST_WR[square]; break;
                case BR: black_score += PST_BR[square]; break;
                case WQ: white_score += PST_WQ[square]; break;
                case BQ: black_score += PST_BQ[square]; break;
                case WK: white_score += PST_WK[square]; break;
                case BK: black_score += PST_BK[square]; break;
                case WZ: white_score += PST_WZ[square]; break;
                case BZ: black_score += PST_BZ[square]; break;
                case WF: white_score += PST_WF[square]; break;
                case BF: black_score += PST_BF[square]; break;
                case WC: white_score += PST_WC[square]; break;
                case BC: black_score += PST_BC[square]; break;
                default: break;
            }
        }
    }

    return (white_score - black_score) * color;
}