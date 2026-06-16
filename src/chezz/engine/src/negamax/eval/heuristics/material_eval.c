#include "material_eval.h"

// const MaterialValues material_table[TOTAL_TYPES] = {
//     {200,       200,        220},   // WP
//     {200,       200,        220},   // BP
//     {700,       750,        720},   // WN
//     {700,       750,        720},   // BN
//     {700,       750,        720},   // WB
//     {700,       750,        720},   // BB
//     {800,       800,        850},   // WR
//     {800,       800,        850},   // BR
//     {1300,     1500,       2000},   // WQ
//     {1300,     1500,       2000},   // BQ
//     {50000,   50000,      50000},   // WK
//     {50000,   50000,      50000},   // BK
//     {300,       325,        350},   // WZ
//     {300,       325,        350},   // BZ
//     {550,       600,        500},   // WF
//     {550,       600,        500},   // WF
//     {1000,     1000,       1000},   // WC
//     {1000,     1000,       1000}    // BC
// };

const MaterialValues material_table[TOTAL_TYPES] = {
    {400,       400,        440},   // WP
    {400,       400,        440},   // BP
    {1400,      1500,       1440},  // WN
    {1400,      1500,       1440},  // BN
    {1400,      1500,       1440},  // WB
    {1400,      1500,       1440},  // BB
    {1600,      1600,       1700},  // WR
    {1600,      1600,       1700},  // BR
    {3500,      3600,       4000},  // WQ
    {3500,      3600,       4000},  // BQ
    {100000,    100000,     100000},// WK
    {100000,    100000,     100000},// BK
    {600,       650,        700},   // WZ
    {600,       650,        700},   // BZ
    {1100,      1200,       1000},  // WF
    {1100,      1200,       1000},  // WF
    {2000,      2000,       2000},  // WC
    {2000,      2000,       2000}   // BC
};


/*
 * Evaluates material balance of a Chezzboard move, adjusted for game phase and side to move.
 * board: Ptr to Chezzboard move to evaluate.
 * color: 1 for white, -1 for black.
 * Returns int score relative to the side to move (positive favors the current player).
 */
int material_score(const Chezzboard *board, int color) {

    /* 1. Initialization */
    // separate material values for different game phases
    int white_start = 0, white_mid = 0, white_end = 0;
    int black_start = 0, black_mid = 0, black_end = 0;
    int non_peon_zombie_material = 0;

    
    /* 2. Count total material on the board for each piece */
    for (int i = WP; i <= BC; i++) {

        // count bits
        int count = __builtin_popcountll(board->pieces[i]);

        // track non-peon and for phase adjustment
        if (i != WP && i != BP && i != WZ && i != BZ) {
            non_peon_zombie_material += count * material_table[i].midgame;
        }

        // white pieces
        if (i % 2 == 0) {
            white_start += count * material_table[i].startgame;
            white_mid += count * material_table[i].midgame;
            white_end += count * material_table[i].endgame;
        } 
        
        // black pieces
        else {
            black_start += count * material_table[i].startgame;
            black_mid += count * material_table[i].midgame;
            black_end += count * material_table[i].endgame;
        }
    }

    /* 2. Compute game phase based on remaining material */
    // total starting material in centipawns (midgame values, excluding kings)
    // static const int start_non_peon_zombie_material = 
    //     (2 * 700) + (2 * 700)  +   // WN BN
    //     (1 * 700) + (1 * 700)  +   // WB BB
    //     (1 * 800) + (1 * 800)  +   // WR BR
    //    (1 * 1300) + (1 * 1300) +   // WQ BQ
    //     (1 * 550) + (1 * 550)  +   // WF BF
    //    (1 * 1000) + (1 * 1000) +   // WC BC
    //   (1 * 50000) + (1 * 50000);   // WK BK

    static const int start_non_peon_zombie_material = 
    (2 * 1400) + (2 * 1400)  +     // WN BN
    (1 * 1400) + (1 * 1400)  +     // WB BB
    (1 * 1600) + (1 * 1600)  +     // WR BR
    (1 * 3500) + (1 * 3500)  +     // WQ BQ
    (1 * 1100) + (1 * 1100)  +     // WF BF
    (1 * 2000) + (1 * 2000)  +     // WC BC
    (1 * 100000) + (1 * 100000);   // WK BK

    
    // calc phase transition factor
    float phase_factor = (float)non_peon_zombie_material / start_non_peon_zombie_material;

    // safeguard in case
    if (phase_factor < 0.0f) phase_factor = 0.0f;
    if (phase_factor > 1.0f) phase_factor = 1.0f;

    int white_score, black_score;

    // startgame to midgame
    if (phase_factor > 0.5f) {
        float t = (phase_factor - 0.5f) * 2.0f;  // to 0.0 → 1.0
        white_score = white_start + (int)((white_mid - white_start) * t);
        black_score = black_start + (int)((black_mid - black_start) * t);
    } 
    // midgame to endgame
    else {
        float t = phase_factor * 2.0f;
        white_score = white_mid + (int)((white_end - white_mid) * t);
        black_score = black_mid + (int)((black_end - black_mid) * t);
    }

    return (white_score - black_score) * color;
}
