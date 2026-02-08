// firebase-config.js
const firebaseConfig = {
    apiKey: "AIzaSyDpLElX0YR32nUHwASpK-ewBJ_6uWixOiI",
    authDomain: "cryptoverseplatform.firebaseapp.com",
    projectId: "cryptoverseplatform",
    storageBucket: "cryptoverseplatform.firebasestorage.app",
    messagingSenderId: "533486874343",
    appId: "1:533486874343:web:bcf58f3c2247942ebb7c42",
    
    // Опционально (если будете использовать базу данных реального времени):
    // databaseURL: "https://cryptoverseplatform-default-rtdb.firebaseio.com/"
};

// Для совместимости с разными версиями кода
if (typeof module !== 'undefined' && module.exports) {
    // Для Node.js/CommonJS
    module.exports = { firebaseConfig };
} else {
    // Для браузера (глобальная переменная)
    window.firebaseConfig = firebaseConfig;
}