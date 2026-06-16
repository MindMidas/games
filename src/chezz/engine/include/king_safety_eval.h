/*
 * Header file for Chezzboard king safety evaluation. Defines constants, and function prototypes.
 */

#ifndef KING_SAFETY_EVAL_H
#define KING_SAFETY_EVAL_H

#include "chezz.h"

/* Defines penalty for each peon that is missing from the king shield */
#define MISSING_PEON_KING_SHIELD 10

/* Defines penalty for each enemy piece type in king ring */
#define ENEMY_QUEEN_IN_KING_RING 35
#define ENEMY_ROOK_IN_KING_RING 20
#define ENEMY_BISHOP_IN_KING_RING 15
#define ENEMY_KNIGHT_IN_KING_RING 15
#define ENEMY_ZOMBIE_IN_KING_RING 15
#define ENEMY_FLINGER_IN_KING_RING 10
#define ENEMY_CANON_IN_KING_RING 10
#define ENEMY_PEON_KING_RING_MED 20
#define ENEMY_PEON_KING_RING_LOW 5


/* Defines penalty where a King on a semi-open column */
#define KING_ON_SEMI_OPEN_COL 15

/* Defines penalty where a King on an open column */
#define KING_ON_OPEN_COL 30


/* Function declarations for king_safety_eval.c. */
int is_king_in_check(const Chezzboard *board, int color);
int king_safety_score(const Chezzboard *board, int color);
int is_king_alive(const Chezzboard *board, int color);

#endif // KING_SAFETY_EVAL_H
