// === КОНФИГУРАЦИЯ FIREBASE ===
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Инициализация Firebase
let db;
let auth;
let currentUser = null;
let usersRef;
let dealsRef;
let ordersRef;
let gamesRef;
let projectsRef;
let notificationsRef;

// === ОСНОВНОЙ ОБЪЕКТ ПЛАТФОРМЫ (ДЛЯ КЛИЕНТА) ===
const platform = {
    balance: 0,
    pendingProfit: 0,
    userData: {},
    cryptoPrices: {},
    projects: {},
    deals: [],
    orders: [],
    notifications: [],
    casinoGames: {},
    
    // Временные данные для анимаций
    tempData: {
        isOnline: false,
        lastUpdate: Date.now(),
        animationQueue: []
    }
};

// === ИНИЦИАЛИЗАЦИЯ ПЛАТФОРМЫ ===
async function initPlatform() {
    try {
        // Проверяем, находится ли пользователь в Telegram
        if (window.Telegram && Telegram.WebApp) {
            initTelegramWebApp();
        }
        
        // Инициализируем Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        
        db = firebase.firestore();
        auth = firebase.auth();
        
        // Создаем ссылки на коллекции
        usersRef = db.collection("users");
        dealsRef = db.collection("deals");
        ordersRef = db.collection("orders");
        gamesRef = db.collection("games");
        projectsRef = db.collection("projects");
        notificationsRef = db.collection("notifications");
        cryptoRef = db.collection("crypto");
        
        // Авторизация через Telegram или анонимно
        await initAuth();
        
        // Загружаем начальные данные
        await loadInitialData();
        
        // Настраиваем реальные обновления
        setupRealtimeUpdates();
        
        // Инициализируем интерфейс
        initUI();
        
        // Запускаем анимации загрузки
        showLoadingAnimation();
        
    } catch (error) {
        console.error("Ошибка инициализации:", error);
        showError("Ошибка подключения. Пожалуйста, обновите страницу.");
    }
}

// === АВТОРИЗАЦИЯ ===
async function initAuth() {
    // Если пользователь в Telegram, используем его данные
    if (window.Telegram && Telegram.WebApp.initDataUnsafe?.user) {
        const tgUser = Telegram.WebApp.initDataUnsafe.user;
        const userId = `tg_${tgUser.id}`;
        
        // Создаем кастомный токен через ваш сервер
        // Для теста используем анонимную авторизацию
        const credential = await auth.signInAnonymously();
        currentUser = credential.user;
        
        // Сохраняем/обновляем данные пользователя
        await usersRef.doc(userId).set({
            id: userId,
            telegramId: tgUser.id,
            username: tgUser.username || `user_${tgUser.id}`,
            firstName: tgUser.first_name,
            lastName: tgUser.last_name,
            photoUrl: tgUser.photo_url,
            balance: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
            online: true
        }, { merge: true });
        
        currentUser.uid = userId;
        
    } else {
        // Анонимная авторизация
        const credential = await auth.signInAnonymously();
        currentUser = credential.user;
        
        await usersRef.doc(currentUser.uid).set({
            id: currentUser.uid,
            username: `user_${Date.now()}`,
            balance: 0,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
            online: true
        }, { merge: true });
    }
    
    // Обновляем статус онлайн
    setUserOnline(true);
    
    // Отслеживаем статус подключения
    firebase.database().ref('.info/connected').on('value', (snapshot) => {
        platform.tempData.isOnline = snapshot.val() === true;
        updateConnectionStatus();
    });
}

// === ЗАГРУЗКА ДАННЫХ ===
async function loadInitialData() {
    showLoading("Загрузка данных...");
    
    // 1. Загружаем данные пользователя
    const userDoc = await usersRef.doc(currentUser.uid).get();
    platform.userData = userDoc.data() || {};
    platform.balance = platform.userData.balance || 0;
    
    // 2. Загружаем проекты
    const projectsSnapshot = await projectsRef.get();
    projectsSnapshot.forEach(doc => {
        platform.projects[doc.id] = doc.data();
    });
    
    // 3. Загружаем сделки (только активные)
    const dealsSnapshot = await dealsRef.where('status', '==', 'active').get();
    platform.deals = [];
    dealsSnapshot.forEach(doc => {
        platform.deals.push({ id: doc.id, ...doc.data() });
    });
    
    // 4. Загружаем ордеры
    const ordersSnapshot = await ordersRef.orderBy('timestamp', 'desc').limit(50).get();
    platform.orders = [];
    ordersSnapshot.forEach(doc => {
        platform.orders.push({ id: doc.id, ...doc.data() });
    });
    
    // 5. Загружаем крипто-цены
    const cryptoSnapshot = await cryptoRef.doc('prices').get();
    platform.cryptoPrices = cryptoSnapshot.data() || {};
    
    // 6. Загружаем уведомления пользователя
    const notificationsSnapshot = await notificationsRef
        .where('userId', '==', currentUser.uid)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();
    
    platform.notifications = [];
    notificationsSnapshot.forEach(doc => {
        platform.notifications.push({ id: doc.id, ...doc.data() });
    });
    
    hideLoading();
}

// === НАСТРОЙКА РЕАЛЬНЫХ ОБНОВЛЕНИЙ ===
function setupRealtimeUpdates() {
    // 1. Слушаем обновления баланса пользователя
    usersRef.doc(currentUser.uid).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            platform.balance = data.balance || 0;
            updateBalanceDisplay();
        }
    });
    
    // 2. Слушаем новые сделки в реальном времени
    dealsRef.where('status', '==', 'active')
        .onSnapshot((snapshot) => {
            platform.deals = [];
            snapshot.forEach(doc => {
                platform.deals.push({ id: doc.id, ...doc.data() });
            });
            updateDealsList();
            showNotification("Обновлены сделки на рынке");
        });
    
    // 3. Слушаем новые ордеры
    ordersRef.orderBy('timestamp', 'desc').limit(50)
        .onSnapshot((snapshot) => {
            platform.orders = [];
            snapshot.forEach(doc => {
                platform.orders.push({ id: doc.id, ...doc.data() });
            });
            updateOrderBook();
        });
    
    // 4. Слушаем изменения крипто-цен
    cryptoRef.doc('prices').onSnapshot((doc) => {
        if (doc.exists) {
            platform.cryptoPrices = doc.data();
            updateCryptoPricesDisplay();
            
            // Анимация изменения цены
            animatePriceChange();
        }
    });
    
    // 5. Слушаем новые уведомления
    notificationsRef
        .where('userId', '==', currentUser.uid)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
            platform.notifications = [];
            snapshot.forEach(doc => {
                platform.notifications.push({ id: doc.id, ...doc.data() });
            });
            updateNotifications();
            
            // Показываем badge для новых уведомлений
            const unread = platform.notifications.filter(n => !n.read).length;
            updateNotificationBadge(unread);
        });
    
    // 6. Слушаем онлайн-пользователей
    usersRef.where('online', '==', true)
        .onSnapshot((snapshot) => {
            updateOnlineUsersCount(snapshot.size);
        });
}

// === ОБНОВЛЕННЫЕ ФУНКЦИИ ДЛЯ РАБОТЫ С СЕРВЕРОМ ===

// 1. ПОПОЛНЕНИЕ БАЛАНСА ЧЕРЕЗ TELEGRAM
async function processDeposit(amountUSD) {
    showLoading("Обработка платежа...");
    
    try {
        // В реальном проекте здесь будет интеграция с платежной системой
        // Для демо - просто добавляем баланс
        
        const skyAmount = Math.floor(amountUSD * 800);
        
        // Обновляем баланс в Firebase
        await usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(skyAmount),
            totalDeposited: firebase.firestore.FieldValue.increment(amountUSD)
        });
        
        // Создаем транзакцию
        await db.collection('transactions').add({
            userId: currentUser.uid,
            type: 'deposit',
            amount: skyAmount,
            amountUSD: amountUSD,
            status: 'completed',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            method: 'telegram'
        });
        
        // Отправляем уведомление
        await createNotification(
            currentUser.uid,
            'Пополнение баланса',
            `Ваш баланс пополнен на ${skyAmount.toLocaleString()} SKY ($${amountUSD})`,
            'success'
        );
        
        hideLoading();
        showSuccess(`Баланс пополнен на ${skyAmount.toLocaleString()} SKY!`);
        
    } catch (error) {
        hideLoading();
        showError("Ошибка при пополнении баланса");
        console.error(error);
    }
}

// 2. ВЫВОД СРЕДСТВ
async function processWithdraw(amountSKY, method, details) {
    showLoading("Обработка вывода...");
    
    try {
        // Проверяем минимальную сумму
        if (amountSKY < 100) {
            throw new Error("Минимальная сумма вывода - 100 SKY");
        }
        
        // Проверяем баланс
        if (amountSKY > platform.balance) {
            throw new Error("Недостаточно средств");
        }
        
        // Рассчитываем комиссии
        const feePlatform = amountSKY * 0.01;
        const feeNetwork = calculateNetworkFee(method, amountSKY);
        const total = amountSKY - feePlatform - feeNetwork;
        
        // Создаем заявку на вывод
        const withdrawRequest = {
            userId: currentUser.uid,
            amount: amountSKY,
            amountReceived: total,
            method: method,
            details: details,
            feePlatform: feePlatform,
            feeNetwork: feeNetwork,
            status: 'pending',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('withdrawals').add(withdrawRequest);
        
        // Резервируем средства (в реальном проекте нужно отдельное поле для зарезервированных средств)
        await usersRef.doc(currentUser.uid).update({
            balance: firebase.firestore.FieldValue.increment(-amountSKY)
        });
        
        // Отправляем уведомление
        await createNotification(
            currentUser.uid,
            'Заявка на вывод',
            `Создана заявка на вывод ${amountSKY.toLocaleString()} SKY`,
            'info'
        );
        
        hideLoading();
        showSuccess(`Заявка на вывод создана! Вы получите ${total.toLocaleString()} SKY`);
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

// 3. СОЗДАНИЕ СДЕЛКИ НА РЫНКЕ
async function createDeal(dealData) {
    showLoading("Создание сделки...");
    
    try {
        // Проверяем наличие средств/активов
        if (dealData.type === 'sell') {
            if (dealData.asset === 'project_share') {
                // Проверяем долю в проекте
                const userInvestment = await getUserInvestment(dealData.projectId);
                if (!userInvestment || userInvestment.share < dealData.quantity) {
                    throw new Error("Недостаточно доли для продажи");
                }
            } else {
                // Проверяем крипто-активы
                const userHoldings = await getUserCryptoHoldings(dealData.asset);
                if (!userHoldings || userHoldings < dealData.quantity) {
                    throw new Error("Недостаточно активов для продажи");
                }
            }
        } else {
            // Для покупки проверяем баланс
            const totalCost = dealData.quantity * dealData.price;
            if (totalCost > platform.balance) {
                throw new Error("Недостаточно SKY для покупки");
            }
        }
        
        // Создаем сделку
        const deal = {
            ...dealData,
            userId: currentUser.uid,
            userName: platform.userData.username,
            status: 'active',
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 дней
        };
        
        await dealsRef.add(deal);
        
        // Если продажа - резервируем активы
        if (dealData.type === 'sell') {
            await reserveAssetsForDeal(dealData);
        }
        
        hideLoading();
        showSuccess("Сделка создана!");
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

// 4. ТОРГОВЛЯ НА БИРЖЕ (С ИЗМЕНЕНИЕМ ЦЕН)
async function executeTrade(type, coin, amount, price) {
    showLoading("Выполнение сделки...");
    
    try {
        // Создаем ордер
        const order = {
            userId: currentUser.uid,
            userName: platform.userData.username,
            type: type,
            coin: coin,
            amount: amount,
            price: price,
            total: amount * price,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'executed'
        };
        
        // Сохраняем ордер
        await ordersRef.add(order);
        
        // Обновляем баланс/активы пользователя
        if (type === 'buy') {
            // Покупаем крипто
            await updateUserBalance(-order.total);
            await updateUserCryptoHoldings(coin, amount);
        } else {
            // Продаем крипто
            await updateUserBalance(order.total);
            await updateUserCryptoHoldings(coin, -amount);
        }
        
        // Обновляем цену на основе спроса/предложения
        await updateCryptoPrice(coin, type, amount);
        
        hideLoading();
        showSuccess(`Сделка выполнена! ${type === 'buy' ? 'Куплено' : 'Продано'} ${amount} ${coin}`);
        
    } catch (error) {
        hideLoading();
        showError("Ошибка при выполнении сделки");
    }
}

// 5. ИГРЫ С БОТАМИ
async function joinWheelGame(betAmount) {
    showLoading("Подключение к игре...");
    
    try {
        // Проверяем баланс
        if (betAmount > platform.balance) {
            throw new Error("Недостаточно средств");
        }
        
        // Находим активную игру или создаем новую
        let game = await findActiveWheelGame();
        
        if (!game) {
            // Создаем новую игру
            game = await createNewWheelGame();
            
            // Добавляем ботов, если мало игроков
            setTimeout(async () => {
                const players = await getGamePlayers(game.id);
                if (players.length < 2) {
                    await addBotsToGame(game.id, betAmount);
                }
            }, 3000);
        }
        
        // Добавляем игрока в игру
        await addPlayerToGame(game.id, {
            userId: currentUser.uid,
            userName: platform.userData.username,
            bet: betAmount,
            isBot: false
        });
        
        // Списываем ставку
        await updateUserBalance(-betAmount);
        
        hideLoading();
        showSuccess(`Вы присоединились к игре! Ставка: ${betAmount} SKY`);
        
    } catch (error) {
        hideLoading();
        showError(error.message);
    }
}

// 6. СИСТЕМА БОТОВ ДЛЯ ИГР
async function addBotsToGame(gameId, humanBet) {
    const botCount = Math.floor(Math.random() * 2) + 1; // 1-2 бота
    
    for (let i = 0; i < botCount; i++) {
        const botBet = Math.floor(humanBet * (0.5 + Math.random() * 1.5)); // 50-150% от ставки человека
        const botName = `Бот_${Math.floor(Math.random() * 1000)}`;
        
        await addPlayerToGame(gameId, {
            userId: `bot_${Date.now()}_${i}`,
            userName: botName,
            bet: botBet,
            isBot: true
        });
    }
}

// === АНИМАЦИИ И UI ===

// Анимация загрузки
function showLoading(message = "Загрузка...") {
    const loadingEl = document.createElement('div');
    loadingEl.id = 'global-loading';
    loadingEl.innerHTML = `
        <div class="loading-overlay">
            <div class="loading-spinner">
                <div class="spinner"></div>
                <div class="loading-text">${message}</div>
            </div>
        </div>
    `;
    document.body.appendChild(loadingEl);
    
    // Добавляем стили
    const style = document.createElement('style');
    style.textContent = `
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }
        .loading-spinner {
            text-align: center;
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 5px solid var(--secondary);
            border-top: 5px solid transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        .loading-text {
            color: white;
            font-size: 1rem;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

function hideLoading() {
    const loadingEl = document.getElementById('global-loading');
    if (loadingEl) {
        loadingEl.remove();
    }
}

// Анимация изменения цены
function animatePriceChange() {
    const priceElements = document.querySelectorAll('.crypto-price');
    priceElements.forEach(el => {
        el.style.transform = 'scale(1.1)';
        el.style.color = 'var(--accent)';
        
        setTimeout(() => {
            el.style.transform = 'scale(1)';
            el.style.color = '';
        }, 500);
    });
}

// Уведомления
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i>
            ${message}
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Добавляем стили
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--dark);
                border-left: 4px solid var(--secondary);
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                z-index: 10000;
                animation: slideIn 0.3s ease;
                max-width: 300px;
            }
            .notification.success {
                border-left-color: var(--success);
            }
            .notification.error {
                border-left-color: var(--accent);
            }
            .notification-content {
                display: flex;
                align-items: center;
                gap: 10px;
                color: white;
                font-size: 0.9rem;
            }
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Автоудаление через 5 секунд
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// === ПОЛЕЗНЫЕ ФУНКЦИИ ДЛЯ FIREBASE ===

// Создание уведомления
async function createNotification(userId, title, message, type = 'info') {
    return await notificationsRef.add({
        userId: userId,
        title: title,
        message: message,
        type: type,
        read: false,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// Обновление статуса онлайн
function setUserOnline(online) {
    if (currentUser) {
        usersRef.doc(currentUser.uid).update({
            online: online,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
}

// Обновление крипто-цен с учетом спроса
async function updateCryptoPrice(coin, tradeType, amount) {
    const priceRef = cryptoRef.doc('prices');
    const priceDoc = await priceRef.get();
    const prices = priceDoc.data();
    
    let currentPrice = prices[coin] || 100;
    
    // Изменяем цену на основе торгов
    const changeFactor = (tradeType === 'buy' ? 1.001 : 0.999);
    const volumeFactor = Math.log10(amount + 1) * 0.01;
    
    currentPrice *= changeFactor * (1 + volumeFactor);
    
    // Добавляем случайные колебания
    const randomChange = 0.998 + Math.random() * 0.004;
    currentPrice *= randomChange;
    
    // Ограничиваем минимальную цену
    currentPrice = Math.max(currentPrice, 0.000001);
    
    // Обновляем в базе
    await priceRef.update({
        [coin]: currentPrice,
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// === TELEGRAM WEB APP ИНТЕГРАЦИЯ ===
function initTelegramWebApp() {
    const tg = window.Telegram.WebApp;
    
    // Расширяем приложение на весь экран
    tg.expand();
    
    // Скрываем кнопку "Назад"
    tg.BackButton.hide();
    
    // Настраиваем тему
    const theme = tg.colorScheme;
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    
    // Обработка платежей
    tg.MainButton.setText("Пополнить баланс");
    tg.MainButton.onClick(() => {
        openDepositModal();
    });
    
    // Готовность приложения
    tg.ready();
}

// === ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ===
document.addEventListener('DOMContentLoaded', function() {
    // Показываем загрузку
    showLoading("Инициализация платформы...");
    
    // Запускаем платформу
    setTimeout(() => {
        initPlatform().then(() => {
            console.log("Платформа инициализирована");
        }).catch(error => {
            console.error("Ошибка инициализации:", error);
            showError("Не удалось загрузить приложение");
        });
    }, 1000);
});

// Обработка закрытия страницы
window.addEventListener('beforeunload', function() {
    setUserOnline(false);
});

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

function updateBalanceDisplay() {
    const balanceEl = document.getElementById('balance');
    const usdEl = document.getElementById('balance-usd');
    
    if (balanceEl && usdEl) {
        balanceEl.textContent = platform.balance.toLocaleString('ru-RU') + ' SKY';
        usdEl.textContent = (platform.balance * 0.001).toFixed(2);
    }
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
        statusEl.textContent = platform.tempData.isOnline ? '🟢 В сети' : '🔴 Офлайн';
    }
}

function updateOnlineUsersCount(count) {
    const countEl = document.getElementById('online-users-count');
    if (countEl) {
        countEl.textContent = count.toLocaleString('ru-RU');
    }
}