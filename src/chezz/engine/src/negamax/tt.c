#include "tt.h"
#include "gen_valid_boards.h"

// global persistent transposition table
TranspositionTable TT;

// global mutex table for TT entries
TranspositionTableMutexes TT_Mutexes;

// once-control so tt_init() runs exactly once across concurrent engine calls
static pthread_once_t _tt_once = PTHREAD_ONCE_INIT;


/*
 * Init transposition table and mutexe table.
 * Returns nothing.
 */
void tt_init() {
    
    // paint 0 in TT
    memset(&TT, 0, sizeof(TT));
    
    // init mutexes in TT_Mutexes
    for (int i = 0; i < TT_SIZE; i++) {

        // for each cluster entry init mutex 
        for (int j = 0; j < CLUSTER_SIZE; j++) {
            pthread_mutex_init(&TT_Mutexes.entries[i][j], NULL);
        }
    }
}


void tt_ensure_init() {

    // run tt_init() once ever; subsequent calls from any thread are no-ops
    pthread_once(&_tt_once, tt_init);
}


/*
 * Clears transposition table and destroys its mutexes.
 * Returns nothing.
 */
void tt_clear() {

    // destroy mutexes in TT_Mutexes
    for (int i = 0; i < TT_SIZE; i++) {

        for (int j = 0; j < CLUSTER_SIZE; j++) {
            pthread_mutex_destroy(&TT_Mutexes.entries[i][j]);
        }
    }
    
    memset(&TT, 0, sizeof(TT));
}


/*
 * Probes transposition table for entry matching the hash.
 * hash: Bitboard hash of the board/move to find.
 * Returns ptr to the TTEntry if found, NULL otherwise.
 */
TTEntry* tt_probe(Bitboard hash, Chezzboard *board) {

    // get the index
    int index = hash % TT_SIZE;

    // search cluster
    for (int i = 0; i < CLUSTER_SIZE; i++) {

        // lock cluster entry
        pthread_mutex_lock(&TT_Mutexes.entries[index][i]);

        // if chezz board found
        if (TT.entries[index][i].hash == hash) {

            // check if they are equal
            if (equal(board, &TT.entries[index][i].board)) {

                // unlock cluster entry
                pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);
                
                return &TT.entries[index][i];
            }
            
        }

        // unlock cluster entry
        pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);
    }

    // entry not found
    return NULL;
}


/*
 * Stores a board/move and its evaluation in the transposition table.
 * hash: Bitboard hash of the board/move
 * score: Evaluation score for this move.
 * depth: Depth of move where score was computed.
 * flag: Type of score (TT_EXACT, TT_LOWER, TT_UPPER).
 * board: Ptr to Chezzboard struct for move/board, which we want to copy into the TT.
 * Returns nothing.
 */
void tt_store(Bitboard hash, int score, int depth, TTFlag flag, Chezzboard *board) {
    
    /* 1. Check for existing entry and update if deeper */
    // get the index
    int index = hash % TT_SIZE;
    
    // iterate over each entry in cluster
    for (int i = 0; i < CLUSTER_SIZE; i++) {

        // lock cluster entry
        pthread_mutex_lock(&TT_Mutexes.entries[index][i]);

        // check for existing entry
        if (TT.entries[index][i].hash == hash && equal(&TT.entries[index][i].board, board)) {

            // update if already present with lower depth
            if (depth > TT.entries[index][i].depth) {
                TT.entries[index][i].score = score;
                TT.entries[index][i].depth = depth;
                TT.entries[index][i].flag = flag;
                TT.entries[index][i].board = *board;
            }

            // unlock cluster entry
            pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);

            return;
        }

        // unlock cluster entry
        pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);
    }



    /* 2. Look for an empty slot to store new entry */
    // entry does not exist so check if there's an empty slot
    for (int i = 0; i < CLUSTER_SIZE; i++) {

        // lock cluster entry
        pthread_mutex_lock(&TT_Mutexes.entries[index][i]);

        // check if its empty and insert
        if (TT.entries[index][i].hash == 0) {

            TT.entries[index][i].hash = hash;
            TT.entries[index][i].score = score;
            TT.entries[index][i].depth = depth;
            TT.entries[index][i].flag = flag;
            TT.entries[index][i].board = *board;
            
            // unlock cluster entry
            pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);

            return;
        }

        // unlock cluster entry
        pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);
    }

    

    /* 3. Replace the lowest-depth entry if no empty slot */
    // no empty slot, replace the worst (lowest depth) entry
    int worst_index = 0;
    int worst_depth = -1;

    for (int i = 0; i < CLUSTER_SIZE; i++) {

        // lock cluster entry
        pthread_mutex_lock(&TT_Mutexes.entries[index][i]);

        // set worst depth
        if (i == 0 || TT.entries[index][i].depth < worst_depth) {
            worst_depth = TT.entries[index][i].depth;
            worst_index = i;
        }

        // unlock cluster entry
        pthread_mutex_unlock(&TT_Mutexes.entries[index][i]);
    }

    // lock cluster entry
    pthread_mutex_lock(&TT_Mutexes.entries[index][worst_index]);

    tt_cleanup(&TT.entries[index][worst_index]);
    TT.entries[index][worst_index].hash = hash;
    TT.entries[index][worst_index].score = score;
    TT.entries[index][worst_index].depth = depth;
    TT.entries[index][worst_index].flag = flag;
    TT.entries[index][worst_index].board = *board;

    // unlock cluster entry
    pthread_mutex_unlock(&TT_Mutexes.entries[index][worst_index]);
}



/*
 * Resets transposition table entry to default state.
 * entry: Ptr to TTEntry to clear.
 * Returns nothing.
 */
void tt_cleanup(TTEntry *entry) {
    
    // clear all fields
    entry->hash = 0;
    entry->score = 0;
    entry->depth = 0;
    entry->flag = TT_EXACT; // default
    memset(&entry->board, 0, sizeof(Chezzboard));
}



// Temp Zobrist Table when initially calculating
// Bitboard ZobristTable[TOTAL_TYPES][TOTAL_SQUARES];


/*
 * Initializes the Zobrist hash table with random values.
 * Returns none (void function; populates global ZobristTable).
 */
void init_zobrist() {

    // set fixed seed
    srand(42);

    // iterate over all pieces
    for (int piece = 0; piece < TOTAL_TYPES; piece++) {

        // iterate over each square
        for (int square = 0; square < TOTAL_SQUARES; square++) {

            // generate random 64bit num
            ZobristTable[piece][square] = ((Bitboard)rand() << 32) | rand();
        }
    }
}



/*
 * Generates unique hash for Chezzboard config using Zobrist hashing.
 * board: Ptr to the Chezzboard to hash.
 * Returns unique Bitboard hash of the board config.
 */
Bitboard hash_board(const Chezzboard *board) {
    

    /* 1. Hash pieces on the board */
    Bitboard hash = 0;

    // iterate over all pieces
    for (int piece = 0; piece < TOTAL_TYPES; piece++) {

        // grab the bitboard
        Bitboard bitboard = board->pieces[piece];

        // iterate over bits
        while (bitboard) {

            // get LSB index
            int square = __builtin_ctzll(bitboard);

            // XOR with precomputed value
            hash ^= ZobristTable[piece][square];

            // clear LSB
            bitboard &= bitboard - 1;
        }
    }


    /* 2. Incorporate additional board state */
    // XOR for more uniqueness here
    hash ^= board->white_pieces;
    hash ^= board->black_pieces;
    hash ^= board->all_pieces;

    return hash;
}




/*
 * Exports Zobrist table to a zobrist_table.c file for using in competition.
 * Returns nothing.
 */
void export_zobrist_table() {
    FILE *file = fopen("zobrist_table.c", "w");

    if (!file) {
        printf("Error: Cannot open output file.\n");
        return;
    }

    fprintf(file, "#include \"tt.h\"\n\n");

    fprintf(file, "Bitboard ZobristTable[TOTAL_TYPES][TOTAL_SQUARES] = {\n");

    for (int piece = 0; piece < TOTAL_TYPES; piece++) {
        fprintf(file, "    { ");
        for (int square = 0; square < TOTAL_SQUARES; square++) {

            fprintf(file, "0x%016" PRIx64 "ULL%s", 
                    (uint64_t) ZobristTable[piece][square], 
                    (square < TOTAL_SQUARES - 1) ? ", " : "");

        }
        fprintf(file, " }%s\n", (piece < TOTAL_TYPES - 1) ? "," : "");
    }

    fprintf(file, "};\n");

    fclose(file);
    printf("Zobrist table successfully exported to zobrist_table.c!\n");
}




/*
 * Saves the transposition table (TT) to a file in one go.
 * filename: Path to file to store TT.
 * Returns nothing.
 */
void save_TT(const char *filename) {
    FILE *file = fopen(filename, "wb");
    if (!file) {
        perror("Error opening TT save file");
        return;
    }

    // Save the entire TT in one chunk
    fwrite(&TT, sizeof(TT), 1, file);

    fclose(file);
}



/*
 * Loads the transposition table (and resets mutexes)
 * filename: Path to the file where TT is stored.
 * Returns nothing.
 */
void load_TT(const char *filename) {

    FILE *file = fopen(filename, "rb");
    if (!file) {
        tt_init();
        return;
    }
    
    fread(&TT, sizeof(TT), 1, file);
    fclose(file);
    
    // re-init mutexes after loading TT
    for (int i = 0; i < TT_SIZE; i++) {
        for (int j = 0; j < CLUSTER_SIZE; j++) {
            pthread_mutex_init(&TT_Mutexes.entries[i][j], NULL);
        }
    }
}

