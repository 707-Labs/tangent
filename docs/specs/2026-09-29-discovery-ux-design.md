# Starting and reading a tangent

## Problem

The start page repeats the brand and pushes its useful entry points down.
Search leaves old results selectable while the next query loads, Escape does
not dismiss the popup, and "Surprise me" waits for optional daily picks.
Feed actions need clearer names and touch targets. A thumbnail column also
constrains the entire summary on narrow screens, even below the image.

## Approach

Keep the warm editorial design and existing routes. Bring search, surprise, and
mood choices closer to the top. Search owns one cancellable request per query;
only results for the current query can be selected or submitted. Escape and
blur dismiss the list; keyboard selection stays visible; failures have distinct
copy from an empty search. Surprise uses daily picks when already available and
starts immediately from curated seeds otherwise.

Put the title and description beside the thumbnail, with the summary below at
full width. Explain Read, Like, and More like this through the existing first-use
hint and contextual accessible labels. Name the settings panel for its actual
contents: feed preferences, appearance, and account sync. Group preferences
semantically and provide comfortable action targets.

More like this jumps directly to its appended card, matching explicit dives.
The preview browser reproduced a failed smooth branch scroll with the new card
offscreen; an immediate scroll landed reliably. A direct jump also avoids a
long animated journey when the branch starts several screens above the tail.

## Acceptance

Verify the search race by loading one query, replacing it, and immediately
submitting the new query. Check dismissal and keyboard selection, narrow-screen
layout, settings, and the article reader in the browser. Typecheck and build
must pass without new warnings. Keep short loading placeholders so explicit
dives retain their existing scroll behavior.
