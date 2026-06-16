/*
 * Header file for Chezzboard piece safety evaluation. Defines constants and function prototypes.
 */

#ifndef PIECE_SAFETY_EVAL_H
#define PIECE_SAFETY_EVAL_H

#include "chezz.h"

/* Defines penalty for a piece being en prise (undefended & attacked) */
#define EN_PRISE_PENALTY -50

/*
 * Defines penalty multiplier for being attacked by more enemy pieces than friendly defenders
 */
#define WEAK_DEFENSE_PENALTY -10

/* Defines penalty for being attacked by a lower value piece */
#define LOW_VALUE_TRADE -200

/* Defines reward multiplier if piece is well defended and attackers are weaker */
#define STRONG_DEFENSE_BONUS 10

/* Defines reward if piece is well defended with less material cost */
#define DEFENSE_EFFICIENCY_BONUS 20

/* Defines a penalty multiplier if piece is under canon attack */
#define UNDER_ENEMY_CANON_ATTACK -50

/* Defines reward for attacking the enemy canon movement mask */
#define WATCHING_ENEMY_CANON 15

/* Defines reward for attacking the enemy canon */
#define ATTACKING_ENEMY_CANON 30

/* Defines reward for attacking the enemy king movement mask */
#define WATCHING_ENEMY_KING_MOVES 50


/* Defines reward for attacking the enemy king */
#define CAPTURE_ENEMY_KING 500


/* Defines reward if a piece is undefended and can be captured */
#define FREE_CAPTURE_BONUS 300


/* Defines reward for attacking a valuable piece */
#define HIGH_VALUE_TRADE 100


/* Defines reward for any type of captures */
#define CAPTURE_BASE_BONUS 20




/* Struct to store legal moves mask for a piece */
typedef struct {
    int piece_type;
    int square;
    Bitboard attack_mask;
} AttackMask;


/* Function declarations for piece_safety_eval.c. */
int piece_safety_score(const Chezzboard *board, int color);



#endif // PIECE_SAFETY_EVAL_H
