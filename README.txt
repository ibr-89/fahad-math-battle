Math Race v9.7 Family Logic Fix

Upload these two files to the ROOT of the existing GitHub repository:
1) logic-fixes-v9.7.js  (new file)
2) firebase-config.js   (replace the existing file)

No Firebase Console changes are required.

What changes:
- Selected numbers apply to BOTH operands.
- Disabled numbers never appear on either side.
- Reverse duplicates such as 4×6 / 6×4 are treated as one question.
- Room creation is blocked if requested questions exceed the unique question pool.
- After each round, the correct answer is shown to host and all players.
- Each player sees their own answer as correct/wrong/no answer.
- Host still manually starts the next question.

Immediate test after upload:
Open the site in an Incognito/Private tab to avoid cached firebase-config.js.
