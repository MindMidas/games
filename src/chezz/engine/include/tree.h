/* Header file for managing the search trees in the Chezz game engine. */

#ifndef TREE_H
#define TREE_H

#include "chezz.h"
#include "gen_valid_boards.h"


/* Defines the file path for the precomputed search tree. */
#define SEARCH_TREE_FILE "src/negamax/tree.dat"

/* Defines the max number of moves in the search tree (2^20 entries for now). */
#define MAX_MOVES 1048576

/* Defines states for search tree nodes. */
#define UNEXPLORED 0  // unexplored move
#define EXPLORED   1  // explored move
#define PRUNED     2  // pruned move

/* Struct for a search tree move node. */
typedef struct MoveNode {
    int state;                     // 0 = unexplored, 1 = explored, 2 = pruned
    Bitboard hash;                 // unique board hash
    Chezzboard board;              // the actual chezz board
    int depth;                     // search depth
    int num_moves;                 // number of valid next move nodes
    int subtree_size;              // track size of sub tree
    int end_index;                 // how far up in the array does this subtree go
} MoveNode;

/* Define search tree arrays. */
extern MoveNode ReadTree[MAX_MOVES];
extern MoveNode WriteTree[MAX_MOVES];

/* Struct for the result of loading a tree from file. */
typedef struct {
    bool new_game;  // flag indicating a new game
    int end_index;  // end index of the loaded tree
} LoadFileResult;

/* Function declarations for tree.c. */
void add_move(int index,
              int end_index,
              Bitboard hash, 
              Chezzboard *board,
              int depth,
              int num_moves,
              int state);   // add a move to the tree

void save_tree(); // save the tree to file

LoadFileResult load_tree(Bitboard root_hash, Chezzboard *board); // load the tree from file

// void process_tree_recursive(FILE *fp, 
//                             int read_start_index, 
//                             int read_end_index, 
//                             int write_start_index,
//                             int write_end_index); // process tree recursively (not needed anymore)

#endif // TREE_H