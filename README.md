# Fahad Math Battle

لعبة جداول ضرب جماعية شبيهة بفكرة Kahoot:
- Host ينشئ غرفة ويحصل على Game PIN من 6 أرقام.
- اللاعبون يدخلون من هواتفهم بدون إنشاء حساب.
- الأسئلة من جداول 1 إلى 10 حسب اختيار المضيف.
- لكل سؤال مؤقت.
- الإجابة الصحيحة = 100 نقطة + بونص سرعة حتى 100 نقطة.
- ترتيب بعد كل سؤال (اختياري) + ترتيب نهائي.
- يوجد وضع حفظ وتدريب فردي.


## النسخة البصرية v7

هذه النسخة تغيّر الواجهة فقط إلى هوية Neon Kids: كحلي/سماوي/بنفسجي، بطاقات زجاجية، شاشة سؤال أوضح، Lobby أكثر حماساً، ومنصة Top 3 ذهبية/فضية/برونزية. منطق اللعب وFirebase لم يتغيرا.

## المعمارية

- GitHub Pages: استضافة HTML/CSS/JavaScript.
- Firebase Authentication: Anonymous Sign-in.
- Firebase Realtime Database: الغرف، اللاعبين، الأسئلة، الإجابات والنتائج.

## 1) إنشاء Firebase Project

1. افتح Firebase Console وأنشئ Project.
2. من **Project settings > Your apps** أضف Web App.
3. انسخ `firebaseConfig`.
4. افتح الملف `firebase-config.js` والصق القيم مكان PASTE_...

## 2) تفعيل Anonymous Authentication

Firebase Console:
**Authentication > Sign-in method > Anonymous > Enable**

لا يحتاج اللاعب إلى بريد أو كلمة مرور؛ Firebase ينشئ UID مؤقتاً لكل جهاز.

## 3) إنشاء Realtime Database

Firebase Console:
**Build > Realtime Database > Create Database**

بعد الإنشاء تأكد أن `databaseURL` الصحيح موجود داخل `firebase-config.js`.

## 4) قواعد الأمان

افتح:
**Realtime Database > Rules**

ثم انسخ محتوى `database.rules.json` وانشر القواعد.

ملاحظة: هذه قواعد مناسبة لنسخة عائلية/تعليمية أولية. إذا أصبحت اللعبة عامة على نطاق واسع يفضّل إضافة App Check وربما نقل احتساب النقاط إلى Cloud Functions لمنع العبث من العميل.

## 5) GitHub Pages

ارفع الملفات إلى Repository عام (أو Repo مناسب لخطة GitHub لديك).

ثم:
**Repository > Settings > Pages**
- Source: Deploy from a branch
- Branch: `main`
- Folder: `/ (root)`

بعد النشر سيصبح لديك رابط قريب من:
`https://USERNAME.github.io/REPOSITORY/`

## ملفات المشروع

- `index.html` الواجهة.
- `styles.css` التصميم.
- `app.js` منطق اللعب والمزامنة.
- `firebase-config.js` إعدادات مشروع Firebase.
- `database.rules.json` قواعد أمان Realtime Database.
- `.nojekyll` لتعطيل معالجة Jekyll غير المطلوبة.

## اختبار سريع

1. افتح الرابط على جهاز/متصفح 1 واضغط **إنشاء مسابقة**.
2. انسخ Game PIN.
3. افتح الرابط على جهاز/متصفح 2 واضغط **الانضمام**.
4. اكتب PIN واسم اللاعب.
5. سيظهر اللاعب مباشرة في Lobby عند المضيف.
6. اضغط **ابدأ المسابقة**.
7. أجب من جهاز اللاعب وشاهد الترتيب عند المضيف.

## ملاحظة مهمة عن GitHub Pages

الموقع Static، ولذلك GitHub Pages يعرض الواجهة فقط. التواصل اللحظي بين الأجهزة يتم من خلال Firebase Realtime Database.
