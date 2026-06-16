/* Header file for the transposition table in the Chezz game engine. */

#ifndef TT_H
#define TT_H

#include "chezz.h"
#include <pthread.h>

/*
 * Defines the size of the transposition table.
 * 2^21 = 2,097,152 entries (~1.74 GB).  Doubled from the original 2^20
 * now that the TT persists across moves and accumulates useful positions
 * over the course of a game.
 */
#define TT_SIZE 2097152

/* Defines the number of slots per table entry for collision handling. */
#define CLUSTER_SIZE 4

/* Enum for transposition table node flags. */
typedef enum {
    TT_EXACT,  // exact score
    TT_UPPER,  // upper bound (beta)
    TT_LOWER   // lower bound (alpha)
} TTFlag;

/* Struct for a transposition table entry. */
typedef struct TTEntry {
    Bitboard hash;         // unique board hash
    int score;             // eval score
    int depth;             // search depth
    TTFlag flag;           // bound flag (exact, upper, lower)
    Chezzboard board;      // the actual Chezz board/move
} TTEntry;

/* Struct for the 2D transposition table. */
typedef struct {
    TTEntry entries[TT_SIZE][CLUSTER_SIZE];  // array of TT entries
} TranspositionTable;


/* Struct for the 2D mutex table for TT entries */
typedef struct {
    pthread_mutex_t entries[TT_SIZE][CLUSTER_SIZE];  // array of TT mutexes for entries
} TranspositionTableMutexes;


/* Extern TT and TT_Mutexes for access to table */
extern TranspositionTable TT;
extern TranspositionTableMutexes TT_Mutexes;

/* Global Zobrist table for hashing. */
extern Bitboard ZobristTable[TOTAL_TYPES][TOTAL_SQUARES];

/* Function declarations for tt.c. */
void tt_init();                                       // init the transposition table (call directly only in tests/tools)
void tt_ensure_init();                                // init TT exactly once — safe to call from concurrent engine searches
void tt_clear();                                      // clear the transposition table
TTEntry* tt_probe(Bitboard hash, Chezzboard *board);  // prob the table for an entry
void tt_store(Bitboard hash, 
              int score, 
              int depth, 
              TTFlag flag, 
              Chezzboard *board);                     // store an entry
void tt_cleanup(TTEntry *entry);                      // clean up an entry
void init_zobrist();                                  // init the Zobrist table
Bitboard hash_board(const Chezzboard *board);         // hash a board
void export_zobrist_table();                          // export the Zobrist table
void load_TT(const char *filename);                   // load TT from file
void save_TT(const char *filename);                   // save TT to file

#endif // TT_H