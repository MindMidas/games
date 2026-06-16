/*
 * Header file for Chezzboard pawn structure evaluation. Defines constants, and function prototypes.
 */

#ifndef PEON_STRUCT_EVAL_H
#define PEON_STRUCT_EVAL_H

#include "chezz.h"

/* Defines reward for each peon with a neighbor */
#define PEON_HAS_NEIGHBOR 5


/* Defines reward for each peon protecting a forward peon */
#define PEON_COVERING_PEON 5


/* Defines reward for each peon moving up a row */
#define PEON_HIGH_ROW 5


/* Defines reward for each peon controlling a center square */
#define PEON_DOMINANCE 10


/* Defines reward for each peon with a clear path to zombie promotion. */
#define PASSED_PEONS 5


/* Defines penalty for each peon within same column as another peon. */
#define PEON_SAME_COL 5


/* Defines penalty for each peon that doesn't have any neighbors */
#define LONELY_PEON 5


/* Defines penalty for each backwards peon that is not in the support mask */
#define BACKWARDS_PEON 10


/* Defines penalty for each peon islands */
#define PEON_ISLAND 15


/* Function declarations for peon_struct_eval.c. */
int peon_structure_score(const Chezzboard *board, int color);

#endif // PEON_STRUCT_EVAL_H
