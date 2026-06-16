#include "tree.h"

// store tree
MoveNode ReadTree[MAX_MOVES];
MoveNode WriteTree[MAX_MOVES];

/*
 * Adds a move to WriteTree Array at the index.
 * index: Index in WriteTree where move is stored.
 * end_index: Ending index of subtree in WriteTree.
 * hash: Bitboard hash of board config.
 * board: Ptr to Chezzboard for curr move.
 * depth: Depth of move in search tree.
 * num_moves: Number of legal moves from this position.
 * state: State of the node (EXPLORED, UNEXPLORED, PRUNED).
 * Returns nothing.
 */
void add_move(int index,
              int end_index,
              Bitboard hash, 
              Chezzboard *board, 
              int depth, 
              int num_moves,
              int state) {
                
    WriteTree[index].state = state;
    WriteTree[index].hash = hash;
    WriteTree[index].board = *board;
    WriteTree[index].depth = depth;
    WriteTree[index].num_moves = num_moves;
    WriteTree[index].end_index = end_index;
    WriteTree[index].subtree_size = 0;
}


/*
 * Saves the WriteTree array to a tree.dat file.
 * Returns nothing.
 */
void save_tree() {
    
    FILE *file = fopen(SEARCH_TREE_FILE, "wb");

    if (!file) {
        printf("Error: Could not write search tree to file.\n");
        return;
    }

    // write the entire tree
    fwrite(WriteTree, sizeof(MoveNode), MAX_MOVES, file);

    fclose(file);
}


/*
 * Loads the relevant branch of search tree from a file based on the root hash and board/move.
 * root_hash: Bitboard hash of root move where we want to load subtree.
 * board: Ptr to Chezzboard struct to ensure two boards are equal (avoid invalid collisions).
 * Returns loadFileResult struct with new_game flag and end_index of loaded branch.
 */
LoadFileResult load_tree(Bitboard root_hash, Chezzboard *board) {

    /* 1. Initialize result and open file */
    LoadFileResult result;
    result.new_game = true;
    result.end_index = 0;
    
    FILE *file = fopen(SEARCH_TREE_FILE, "rb");

    if (!file) {
        return result;
    }


    /* 2. Read root move and prepare for branch search */
    // init a temp tree root buffer
    MoveNode temp_root;

    // try reading previous root move
    if (fread(&temp_root, sizeof(MoveNode), 1, file) != 1) {
        fclose(file);

        return result;
    }
    int num_moves = temp_root.num_moves;
    int start_index = 1;
    int available_space = MAX_MOVES - 1;
    int slice_size = available_space / num_moves;
    int extra_moves = available_space % num_moves;

    

    /* 3. Search for matching branch (pruning other branches) */
    for (int i = 0; i < num_moves; i++) {

        // seek subtree
        fseek(file, start_index * sizeof(MoveNode), SEEK_SET);

        int end_index = start_index + slice_size - 1;

        if (i < extra_moves) {
            end_index++;
        }

        // temporary buffer for depth 1 moves
        MoveNode d1_temp_move;

        // move file ptr, stop if we reach EoF
        if (fread(&d1_temp_move, sizeof(MoveNode), 1, file) != 1) {

            printf("Unexpected end of file...\n");
            break;
        }
        
        // check subtree nodes to find the matching move
        int d2_num_moves = d1_temp_move.num_moves;
        int d2_start_index = start_index + 1;
        int d2_avail_space = end_index - start_index;
        int d2_slice_size = d2_avail_space / d2_num_moves;
        int d2_extra_moves = d2_avail_space % d2_num_moves;

        for (int j = 0; j < d2_num_moves; j++) {

            // seek subtree
            fseek(file, d2_start_index * sizeof(MoveNode), SEEK_SET);

            int d2_end_index = d2_start_index + d2_slice_size - 1;
            if (j < d2_extra_moves) {
                d2_end_index++;
            }

            // temporary buffer for depth 2 moves
            MoveNode d2_temp_move;
            
            // move file ptr, stop if we reach EoF
            if (fread(&d2_temp_move, sizeof(MoveNode), 1, file) != 1) {
                printf("Unexpected end of file...\n");
                break;
            }
            
            // compare hashes to see if node exists
            if (d2_temp_move.hash == root_hash) {
                
                // perform board safety check in case of rare hash collisions
                if (equal(&d2_temp_move.board, board) && 
                        d2_temp_move.board.header.turn == board->header.turn) {
                    
                    fseek(file, d2_start_index * sizeof(MoveNode), SEEK_SET);

                    int total_entries = (d2_end_index - d2_start_index) + 1;

                    fread(ReadTree, sizeof(MoveNode), total_entries, file);

                    result.new_game = false;
                    result.end_index = d2_end_index - d2_start_index;

                    fclose(file);
                    return result;
                }
            }

            // update start index for next subtree
            d2_start_index = d2_end_index + 1;
        }

        // update start index for next subtree
        start_index = end_index + 1;

    }

    /* 4. Close file and return default result if no match */
    fclose(file);
    return result;
}



// not needed anymore (kept incase it's needed)
// void process_tree_recursive(FILE *fp, 
//                             int read_start_index, 
//                             int read_end_index, 
//                             int write_start_index,
//                             int write_end_index) {
    
//     // exit if we've exceeded the available range
//     if (read_start_index > read_end_index || write_start_index > write_end_index) {
//         return;
//     }
    
//     // move file ptr to read_start_index
//     fseek(fp, read_start_index * sizeof(MoveNode), SEEK_SET);

//     // read the move into tree at write_start_index
//     fread(&tree[write_start_index], sizeof(MoveNode), 1, fp);

//     // add end_index and clear depth and size for negamax
//     tree[write_start_index].end_index = write_end_index;
//     tree[write_start_index].subtree_size = 0;
//     //tree[write_start_index].depth = 0;

//     // get num moves
//     int num_moves = tree[write_start_index].num_moves;


//     // calculate for READ
//     // partition the remaining memory among next moves at current depth
//     int read_available_space = read_end_index - read_start_index;
//     int read_slice_size = read_available_space / num_moves;
//     int read_extra_moves = read_available_space % num_moves;


//     // calculate for WRITE
//     int write_available_space = write_end_index - write_start_index;
//     int write_slice_size = write_available_space / num_moves;
//     int write_extra_moves = write_available_space % num_moves;


//     // increment index for READ and WRITE
//     read_start_index = read_start_index + 1;
//     write_start_index = write_start_index + 1;


//     // iterate over each move
//     for (int i = 0; i < num_moves; i++) {
        
//         // calculate end index for READ and WRITE
//         read_end_index = read_start_index + read_slice_size - 1;
//         write_end_index = write_start_index + write_slice_size - 1;

//         // increment end index for extra moves space
//         if (i < read_extra_moves) {
//             read_end_index++;
//         }
//         if (i < write_extra_moves) {
//             write_end_index++;
//         }

//         // recursively process the subtree
//         process_tree_recursive(fp, read_start_index, read_end_index, write_start_index, write_end_index);
        
//         // update start index
//         read_start_index = read_end_index + 1;
//         write_start_index = write_end_index + 1;
//     }

//     return;
// }
