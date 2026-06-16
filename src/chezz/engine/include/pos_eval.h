/*
 * Header file for Chezzboard piece position evaluation (using PSTs). Defines constants, and function prototypes.
 */

#ifndef POS_EVAL_H
#define POS_EVAL_H

#include "chezz.h"

/* PST Arrays storing score at each square in the board for that piece type. */
extern int PST_WP[TOTAL_SQUARES];
extern int PST_BP[TOTAL_SQUARES];
extern int PST_WN[TOTAL_SQUARES];
extern int PST_BN[TOTAL_SQUARES];
extern int PST_WB[TOTAL_SQUARES];
extern int PST_BB[TOTAL_SQUARES];
extern int PST_WR[TOTAL_SQUARES];
extern int PST_BR[TOTAL_SQUARES];
extern int PST_WQ[TOTAL_SQUARES];
extern int PST_BQ[TOTAL_SQUARES];
extern int PST_WK[TOTAL_SQUARES];
extern int PST_BK[TOTAL_SQUARES];
extern int PST_WZ[TOTAL_SQUARES];
extern int PST_BZ[TOTAL_SQUARES];
extern int PST_WF[TOTAL_SQUARES];
extern int PST_BF[TOTAL_SQUARES];
extern int PST_WC[TOTAL_SQUARES];
extern int PST_BC[TOTAL_SQUARES];

/* Function declarations for pos_eval.c. */
int pos_score(const Chezzboard *board, int color);



#endif // POS_EVAL_H
