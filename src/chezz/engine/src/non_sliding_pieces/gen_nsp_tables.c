#include "nsp.h"

Bitboard nsp_table_temp[TOTAL_TYPES][TOTAL_SQUARES];


/*
 * Gen and saves move tables for non-sliding pieces for every square.
 * Returns nothing.
 */
void gen_nsp_table() {

    /* 1. Generate moves for each piece type per square */
    // iterate over all squares on the board
    for (int square = 0; square < TOTAL_SQUARES; square++) {

        // compute knight moves 
        Bitboard knight_moves = gen_knight_mask(square);
        nsp_table_temp[WN][square] = knight_moves;
        nsp_table_temp[BN][square] = knight_moves;
        
        // no need to compute bishop moves as we have magic board now
        // Bitboard bishop_moves = gen_bishop_mask(square);
        // move_tables[WB][square] = bishop_moves;
        // move_tables[BB][square] = bishop_moves;

        // no need to compute rook moves as we have a magic board
        // Bitboard rook_moves = gen_rook_mask(square);
        // move_tables[WR][square] = rook_moves;
        // move_tables[BR][square] = rook_moves;

        // no need to compute queen moves as we rook and bishop magic board
        // Bitboard queen_moves = gen_queen_mask(square);
        // move_tables[WQ][square] = queen_moves;
        // move_tables[BQ][square] = queen_moves;
    
        // compute king moves
        Bitboard king_moves = gen_king_mask(square);
        nsp_table_temp[WK][square] = king_moves;
        nsp_table_temp[BK][square] = king_moves;

        // compute zombie moves
        Bitboard zombie_moves = gen_zombie_mask(square);
        nsp_table_temp[WZ][square] = zombie_moves;
        nsp_table_temp[BZ][square] = zombie_moves;

        // compute catapult moves
        Bitboard catapult_moves = gen_catapult_mask(square);
        nsp_table_temp[WF][square] = catapult_moves;
        nsp_table_temp[BF][square] = catapult_moves;

        // compute canon moves
        Bitboard canon_moves = gen_canon_mask(square);
        nsp_table_temp[WC][square] = canon_moves;
        nsp_table_temp[BC][square] = canon_moves;

        // compute peon moves
        nsp_table_temp[WP][square] = gen_peon_mask(square, 1);
        nsp_table_temp[BP][square] = gen_peon_mask(square, -1);
        
    }


    /* 2. Save the generated table to file */
    // save table
    FILE *file = fopen(NSP_TABLE_FILE, "wb");

    // error handling
    if (!file) {
        printf("Error: Could not write move table file\n");
        return;
    }

    // write move tables to file
    fwrite(nsp_table_temp, sizeof(nsp_table_temp), 1, file);

    fclose(file);

    // printf("Move tables generated and saved to %s\n", NSP_TABLE_FILE);
}



/*
 * Loads the precomputed NSP move table from a file.
 * Returns none (void function; populates nsp_table_temp).
 */
void load_nsp_table() {
    FILE *file = fopen(NSP_TABLE_FILE, "rb");

    if (!file) {
        printf("Error: Could not open move table file.\n");
        exit(1);
    }

    // read the precomputed move table into the array
    size_t elements_read = fread(nsp_table_temp, sizeof(Bitboard), TOTAL_TYPES * (TOTAL_SQUARES), file);

    // ensure the entire file was read correctly
    if (elements_read != TOTAL_TYPES * (TOTAL_SQUARES)) {
        printf("Error: Incomplete move table read (%zu elements read).\n", elements_read);
        fclose(file);
        exit(1);
    }

    fclose(file);
}



/*
 * Exports NSP move table to a nsp_table.c file.
 * Returns nothing.
 */
void export_nsp_table() {
    FILE *file = fopen("nsp_table.c", "w");

    if (!file) {
        printf("Error: Cannot open output file!\n");
        return;
    }
    
    fprintf(file, "#include \"nsp.h\"\n\n");

    fprintf(file, "Bitboard nsp_table[TOTAL_TYPES][TOTAL_SQUARES] = {\n");

    for (int type = 0; type < TOTAL_TYPES; type++) {
        fprintf(file, "    { // Type %s\n", piece_lookup[type]);
        for (int square = 0; square < TOTAL_SQUARES; square++) {
            fprintf(file, "        %#" PRIx64 "ULL%s", (uint64_t)nsp_table_temp[type][square],
                                    (square < TOTAL_SQUARES - 1) ? ", " : "");
            
            if ((square + 1) % 8 == 0)
                fprintf(file, "\n");
        }
        fprintf(file, "    }%s\n", (type < TOTAL_TYPES - 1) ? "," : "");
    }

    fprintf(file, "};\n\n");

    fclose(file);
    printf("NSP table successfully exported to nsp_table.txt!\n");
}
