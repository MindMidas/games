/* Header file for managing search across threads in the Chezz game engine. */

#ifndef MANAGE_SEARCH_H
#define MANAGE_SEARCH_H

#include "chezz.h"
#include "gen_valid_boards.h"
#include "tt.h"
#include <pthread.h>
#include "negamax.h"


/* Struct to keep track of search across threads. */
typedef struct {
    pthread_mutex_t lock;      // mutex lock to avoid race conds
    int alpha;                 // shared alpha bound
    int beta;                  // shared beta bound
    int best_score;            // best score found so far
    Chezzboard best_move;      // best move found so far
} SearchState;

/* Struct for thread search args. */
typedef struct {
    int thread_id;             // thread id
    int color;                 // curr player’s color (1 for white, -1 for black)
    int max_depth;             // max search depth
    int start_depth;           // start depth for search
    int num_moves;             // num moves to evaluate
    Chezzboard *moves;         // moves to evaluate
    SearchState *state;        // per-call search state (replaces global_search_state)
} ThreadArgs;

// global_search_state removed: SearchState is now local to start_search()
// and passed to threads via ThreadArgs.state


/* Function declarations for manage_search.c. */
Chezzboard start_search(Chezzboard *board);   // initiate the search process and returns best move
void *search_thread(void *arg);               // thread function for parallel search


#endif // MANAGE_SEARCH_H
