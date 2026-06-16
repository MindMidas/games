/*
 * Header file for Chezzboard piece mobility evaluation. Defines constants, and function prototypes.
 */

#ifndef MOBILITY_EVAL_H
#define MOBILITY_EVAL_H

#include "chezz.h"


/* Defines penalty for being in a friendly canon's attack mask */
#define BLOCKING_CANON_SHOT -15

/* Defines reward for being behind a friendly catapult */
#define BEHIND_FRIENDLY_CATAPULT 5

/* Defines reward for Queen and Rook attack masks connecting in row/col */
#define QUEEN_ROOK_COORDINATION 15

/* Defines reward for Queen and Bishop attack masks connecting in diagonals */
#define QUEEN_BISHOP_COORDINATION 10

/* Defines reward for Knights coordinating an attack */
#define KNIGHT_ATTACK_COORDINATION 10

/* Defines reward for Knights defending eachother (trade) */
#define KNIGHT_DEFEND_COORDINATION 10

/* Defines reward for controlling a square (having an edge over opponent) */
#define CONTROLLING_SQUARES 2

/* Defines reward for controlling a square (having an edge over opponent) */
#define KING_ATTACK_COORDINATION 15



/* // Mobility penalty table for each piece (unsafe squares) */
extern const int immobility_penalty[TOTAL_TYPES];


/* // Mobility reward table for each piece (safe squares) */
extern const int mobility_reward[TOTAL_TYPES];


/* Struct to store legal moves mask for a piece */
typedef struct {
    int piece_type;
    int square;
    Bitboard legal_moves;
} LegalMoves;


/* Function declarations for mobility_eval.c. */
int mobility_score(const Chezzboard *board, int color);

#endif // MOBILITY_EVAL_H