#include "manage_search.h"
#include "negamax.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

// global_search_state removed: SearchState is stack-allocated in start_search()
// and passed to threads via ThreadArgs.state for concurrent-safe operation

static int cpu_count(void) {
#ifdef _WIN32
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    return (int)(info.dwNumberOfProcessors > 0 ? info.dwNumberOfProcessors : 1);
#else
    long count = sysconf(_SC_NPROCESSORS_ONLN);
    return (int)(count > 0 ? count : 1);
#endif
}


/*
 * Initiates multi-threaded search for starting chezz board config negamax algo.
 * board: Ptr to Chezzboard struct for root move.
 * Returns nothing.
 * TODO: Iterative deepening and add cleanup.
 */
Chezzboard start_search(Chezzboard *board) {

    /* 1. Initialization */
    int color = (board->header.turn == WHITE) ? 1 : -1;
    int num_moves;
    ValidBoards next_moves;

    // per-call search state (stack-allocated so concurrent searches don't share it)
    SearchState state;
    memset(&state, 0, sizeof(SearchState));
    pthread_mutex_init(&state.lock, NULL);
    state.alpha = -INFINITY;
    state.beta = INFINITY;
    state.best_score = (-INFINITY - 1);

    
    /* 2. Logic to calculate MAX_DEPTH */
    int max_depth = 4;
    int start_depth = 1;


    /* 3. Ensure TT is initialized (runs exactly once ever) */
    // load_TT("tt.dat");
    tt_ensure_init();
    
    
    /* 4. Move deneration for new game */
    next_moves = gen_chezz_boards(board, color);
    num_moves = next_moves.count;

    // No legal moves from this position: return current board unchanged.
    if (num_moves <= 0) {
        free_chezz_boards(&next_moves);
        pthread_mutex_destroy(&state.lock);
        return *board;
    }

    // Seed a safe fallback move so we never return an uninitialized board.
    state.best_move = next_moves.boards[0];


    /* 5. Thread configuration */
    int num_threads = cpu_count();
    if (num_threads > num_moves) {
        num_threads = num_moves;
    }

    // calculate total moves each thread must evaluate
    int thread_num_moves = num_moves / num_threads;
    int thread_extra_moves = num_moves % num_threads;
    int current_thread = 0;
    int moves_assigned = 0;


    /*
     * 6. Thread setup
     * - Create thread arrays and assign moves
     */
    pthread_t threads[num_threads];
    ThreadArgs thread_args[num_threads];

    for (int i = 0; i < num_threads; i++) {
        
        // assign extra moves and malloc move indexes array 
        int moves_for_this_thread = thread_num_moves + (i < thread_extra_moves ? 1 : 0);
        thread_args[i].thread_id = i;
        thread_args[i].max_depth = max_depth;
        thread_args[i].state = &state;   // per-call state ptr for thread sync
        thread_args[i].moves = malloc(moves_for_this_thread * sizeof(Chezzboard));
        
        if (!thread_args[i].moves) {
            perror("malloc failed");
            exit(EXIT_FAILURE);
        }

        // zero out memory
        memset(thread_args[i].moves, 0, moves_for_this_thread * sizeof(Chezzboard));

        if (!thread_args[i].moves) {
            perror("malloc failed");
            exit(EXIT_FAILURE);
        }
        // set num_moves this thread is handling
        thread_args[i].num_moves = moves_for_this_thread;
    }
    

    /* 8. Assign moves and launch thread */
    for (int i = 0; i < num_moves; i++) {
        
        Chezzboard move = select_best_move(&next_moves);
        thread_args[current_thread].moves[moves_assigned] = move;
        moves_assigned++;

        // calc total moves for current thread
        int moves_for_current = thread_num_moves + (current_thread < thread_extra_moves ? 1 : 0);
        
        // if current thread has been assigned all its moves, start the thread
        if (moves_assigned == moves_for_current) {

            thread_args[current_thread].color = color;
            thread_args[current_thread].start_depth = start_depth;
            if (pthread_create(&threads[current_thread], NULL, search_thread, &thread_args[current_thread]) != 0) {
                perror("Thread creation failed");
                exit(EXIT_FAILURE);
            }

            current_thread++;
            moves_assigned = 0;
        }
    }


    /* 9. Wait for threads to return from search */
    Chezzboard best_move;
    
    for (int i = 0; i < num_threads; i++) {
        pthread_join(threads[i], NULL);
    }

    // get best move and score
    best_move = state.best_move;

    // int best_score = state.best_score;
    
    /* 10. Cleanup and store move score in TT */
    // Free each thread's allocated moves array.
    for (int i = 0; i < num_threads; i++) {
        free(thread_args[i].moves);
    }

    free_chezz_boards(&next_moves);
    pthread_mutex_destroy(&state.lock); // clean up per-call mutex

    // tt_store(hash_board(board), best_score, board->header.num_moves, TT_EXACT, board);
    //save_TT("tt.dat");
    
    // FILE *file = fopen("game.out", "a");
    // if (file == NULL) {
    //     perror("Error opening game.out");
    //     exit(EXIT_FAILURE);
    // }
    // fprintf(file, "Best Score: %d\n", best_score);
    // fclose(file);

    return best_move;
}


/*
 * Thread function to execute negamax search on its assigned moves.
 * arg: Ptr to ThreadArgs struct with thread-specific data.
 * Returns nULL (void* required by pthread API; results are stored in ThreadArgs and WriteTree).
 */
void *search_thread(void *arg) {
    
    // init vars
    Chezzboard move;
    int score = -INFINITY;

    // setup args
    ThreadArgs *args = (ThreadArgs *)arg;
    SearchState *state = args->state;   // per-call state passed from start_search()
    int best_score = -INFINITY;

    // iterate over moves assigned to this thread
    for (int i = 0; i < args->num_moves; i++) {

        // get global alpha and beta
        pthread_mutex_lock(&state->lock);
        int alpha = state->alpha;
        int beta = state->beta;
        pthread_mutex_unlock(&state->lock);

        // get move
        move = args->moves[i];

        // beta cutoff, prune branch
        if (alpha >= beta) {
            break;
        }

        // run NegaMax search on the move
        score = MAX(score, -negamax(&move, args->start_depth, args->max_depth, -beta, -alpha, -args->color));

        // update: best_score and global alpha
        if (score > best_score) {
            best_score = score;

            // update global alpha for pruning
            pthread_mutex_lock(&state->lock);
            if (best_score > state->best_score) {
                state->best_score = best_score;
                state->alpha = best_score;
                state->best_move = move;
            }
            pthread_mutex_unlock(&state->lock);

        }
    }

    return NULL;
}
