# Starting and reading a tangent

## Problem

The start page repeats the brand and pushes its useful entry points down.
Search leaves old results selectable while the next query loads, Escape does
not dismiss the popup, and "Surprise me" waits for optional daily picks.
Feed actions need clearer names and touch targets. A thumbnail column also
constrains the entire summary on narrow screens, even below the image.

## Approach

Keep the warm editorial design and existing routes. Bring search, surprise, and
topic choices closer to the top. Search owns one cancellable request per query;
only results for the current query can be selected or submitted. Escape and
blur dismiss the list; keyboard selection stays visible; failures have distinct
copy from an empty search. Surprise uses daily picks when already available and
starts immediately from curated seeds otherwise.

Put the title and description beside the thumbnail, with the summary below at
full width. Explain Read, Like, and More like this through the existing first-use
hint and contextual accessible labels. Name the settings panel for its actual
contents: feed preferences and appearance. Give sign-in its own visible header action
and dedicated account drawer so it does not sit below personalization controls. Group preferences
semantically and provide comfortable action targets.

More like this jumps directly to its appended card, matching explicit dives.
The preview browser reproduced a failed smooth branch scroll with the new card
offscreen; an immediate scroll landed reliably. A direct jump also avoids a
long animated journey when the branch starts several screens above the tail.

Keep headings in sentence case and remove the decorative slogan. Use short copy
that describes the next action. Four compact appearance choices replace the palette
gallery, retaining High contrast and migrating saved preferences before paint.

At narrow phone widths, reserve space for Sign in and the trail by moving the graph
shortcut into Settings and using the brand symbol alone below 23rem. The shell
only widens for an open reader on the feed route. Current browser measurements at
320px, 375px, and wider widths confirm matching centerlines and no horizontal overflow;
the originally reported preview offset was not reproduced in the DOM.

## Acceptance

Verify the search race by loading one query, replacing it, and immediately
submitting the new query. Check dismissal and keyboard selection, narrow-screen
layout, settings, and the article reader in the browser. Typecheck and build
must pass without new warnings. Keep short loading placeholders so explicit
dives retain their existing scroll behavior.
