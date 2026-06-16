#include "debug.h"

/*
 * Prints the bitboard in a 64-bit binary format.
 * board: Ptr to the Chezzboard to print.
 * Returns nothing.
 */
void print_bitboard(Chezzboard *board) {

    /* 1. Print header and piece bitboards */
    printf("Turn: %c\n", board->header.turn);
    printf("Bitboard Representation:\n");

    // iterate over each piece bitboard
    for (int i = 0; i < TOTAL_TYPES; i++) {
        printf("Piece %s: ", piece_lookup[i]);

        // print 64-bit binary representation
        for (int bit = (TOTAL_SQUARES - 1); bit >= 0; bit--) {
            printf("%" PRIu64, (uint64_t)((board->pieces[i] >> bit) & 1));


            // space for better readability
            if (bit % 8 == 0) 
                printf(" ");
        }

        printf("\n");
    }


    /* 2. Print white, black, and all pieces */
    printf("White BP: ");
    // print 64-bit binary representation
    for (int bit = (TOTAL_SQUARES - 1); bit >= 0; bit--) {

        printf("%" PRIu64, (uint64_t)((board->white_pieces >> bit) & 1));

        // space for better readability
        if (bit % 8 == 0) 
            printf(" ");
    }
    
    printf("\nBlack BP: ");
    // print 64-bit binary representation
    for (int bit = (TOTAL_SQUARES - 1); bit >= 0; bit--) {
        
        printf("%" PRIu64, (uint64_t)((board->black_pieces >> bit) & 1));

        // space for better readability
        if (bit % 8 == 0) 
            printf(" ");
    }

    printf("\nBoard   : ");
    // print 64-bit binary representation
    for (int bit = (TOTAL_SQUARES - 1); bit >= 0; bit--) {
        
        printf("%" PRIu64, (uint64_t)((board->all_pieces >> bit) & 1));

        // space for better readability
        if (bit % 8 == 0) 
            printf(" ");
    }
}


/*
 * Prints the Chezz board in a nice visual format.
 * board: Ptr to the Chezzboard to print.
 * Returns nothing.
 */
void print_chezz_board(Chezzboard *board) {

    /* 1. Print header and board rows */
    printf("\nChezz Board State: turn: %c\n\n", board->header.turn);

    // iterate over rows from top (8) to bottom (1)
    for (int r = 7; r >= 0; r--) {

        printf("%d  ", r + 1);

        // iterate over columns from 'a' to 'h'
        for (int c = 0; c < 8; c++) {

            char square_str[3] = { 'a' + c, '1' + r, '\0' };
            int square = square_to_index(square_str); // convert to Chezzboard index

            char piece_str[3] = "--"; // default

            // iterate over piece bitboards
            for (int i = 0; i < TOTAL_TYPES; i++) {

                // only print if bit is set
                if ((board->pieces[i] >> square) & 1) {
                    snprintf(piece_str, sizeof(piece_str), "%s", piece_lookup[i]);
                    break;
                }
            }

            printf("%-3s ", piece_str); // print piece or empty space
        }

        printf("\n");
    }

    /* 2. Print column labels */
    printf("\n   a   b   c   d   e   f   g   h  \n\n");
}


/*
 * Prints a single bitboard in an 8x8 chessboard format.
 * Chezzboard: 64-bit integer representing the bitboard.
 * Returns nothing.
 */
void print_bitboard_state(Bitboard Chezzboard) {
    printf("\nBitboard State:\n\n");

    // Iterate over rows from top (8) to bottom (1)
    for (int r = 7; r >= 0; r--) {

        printf("%d  ", r + 1); // Print rank number

        // Iterate over columns from 'a' to 'h'
        for (int c = 0; c < 8; c++) {

            char square_str[3] = { 'a' + c, '1' + r, '\0' };
            int square = square_to_index(square_str); // Convert to bitboard index

            // Check if the bit is set at this square
            if ((Chezzboard >> square) & 1) {
                printf(" X  ");  // Mark occupied square with 'X'
            } else {
                printf(" .  ");  // Empty square
            }
        }

        printf("\n");
    }

    // Print column letters
    printf("\n    a   b   c   d   e   f   g   h  \n\n");
}


/*
 * Appends the Chezzboard to "game.out".
 * board: Ptr to the Chezzboard to print.
 * elapsed_time: time taken for move
 * Returns nothing.
 */
void print_chezzboard_to_file(Chezzboard *board, double elapsed_time) {

    FILE *file = fopen("game.out", "a");
    if (!file) {
        perror("Error opening game.out");
        return;
    }

    /* 2. Print header, footer, and board rows */
    fprintf(file, "Search completed in %.2f ms\n", elapsed_time);
    fprintf(file, "\nChezz Board State: turn: %c\n\n", board->header.turn);

    // iterate over rows from top
    for (int r = 7; r >= 0; r--) {

        fprintf(file, "%d  ", r + 1);

        // iterate over columns
        for (int c = 0; c < 8; c++) {

            char square_str[3] = { 'a' + c, '1' + r, '\0' };
            int square = square_to_index(square_str);

            char piece_str[3] = "--"; // default

            // iterate over piece bitboards
            for (int i = 0; i < TOTAL_TYPES; i++) {
                // only print if bit is set
                if ((board->pieces[i] >> square) & 1) {
                    snprintf(piece_str, sizeof(piece_str), "%s", piece_lookup[i]);
                    break;
                }
            }
            fprintf(file, "%-3s ", piece_str);
        }

        fprintf(file, "\n");
    }

    fprintf(file, "\n   a   b   c   d   e   f   g   h  \n\n");

    fclose(file);
}

