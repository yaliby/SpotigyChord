# Spotify → Chords (עם תצוגת אקורדים בתוך האפליקציה)

## מה זה עושה?
- מתחבר לחשבון Spotify שלך (Authorization Code + PKCE)
- מציג את השיר שמתנגן עכשיו (שם/אמן/עטיפה)
- כפתור שטוען את אתר האקורדים הראשון בתוך האפליקציה (iframe פנימי), דרך מנגנון scraping/proxy בצד השרת.

## איך מריצים מקומית
1) התקנת תלויות:
   - `npm install`
   - `npm run playwright:install`
2) הרצת שרת:
   - `npm run dev`
3) פתח בדפדפן:
   - `http://localhost:8080`
4) בתוך האתר:
   - תעתיק את ה־Redirect URI שמופיע ותדביק אותו ב־Spotify Developer App Settings.
   - תדביק Client ID (חד‑פעמי) ותשמור.
   - אם ה־frontend רץ ב־GitHub Pages: הדבק בשדה Backend API את כתובת השרת שלך (Render/Railway/VPS).
   - תלחץ "התחבר ל‑Spotify".

## הרצה בקונטיינר (Playwright בתוך Docker)
1) `docker compose up --build`
2) פתח: `http://localhost:8080`
3) אם ה־frontend נשאר ב־GitHub Pages, הדבק בשדה Backend API את כתובת הקונטיינר/שרת שלך.

## הערות
- אם אין שיר שמתנגן כרגע/אין device פעיל — תראה "אין שיר כרגע".
- האתר שומר את ה־Client ID והטוקנים בלוקאל סטורג' בדפדפן שלך (שימוש אישי).
- תצוגת אתרים חיצוניים בתוך iframe יכולה להיות חלקית, תלוי במבנה האתר היעד.
