const defaultProducts = [
    { id: 1, name: "Campus Hoodie", category: "Apparel", price: 24900, stock: 18, icon: "🧥", sold: 0, color: "#e9edf5", tag: "Campus favourite" },
    { id: 2, name: "KBTU Classic Tee", category: "Apparel", price: 11900, stock: 28, icon: "👕", sold: 0, color: "#eaf0f8", tag: "Everyday essential" },
    { id: 3, name: "Varsity Cap", category: "Apparel", price: 8900, stock: 14, icon: "🧢", sold: 0, color: "#f1eee7", tag: "New" },
    { id: 4, name: "Campus Tote", category: "Accessories", price: 6900, stock: 22, icon: "👜", sold: 0, color: "#f4eee4", tag: "Made for class" },
    { id: 5, name: "KBTU Bottle", category: "Accessories", price: 7900, stock: 6, icon: "🧴", sold: 0, color: "#e8f0f0", tag: "Low stock" },
    { id: 6, name: "Campus Lanyard", category: "Accessories", price: 2900, stock: 35, icon: "🔑", sold: 0, color: "#f0edf6", tag: "Campus essential" },
    { id: 7, name: "Study Notes Set", category: "Stationery", price: 3900, stock: 25, icon: "📓", sold: 0, color: "#f4f0e7", tag: "Study edit" },
    { id: 8, name: "KBTU Notebook", category: "Stationery", price: 3200, stock: 30, icon: "📔", sold: 0, color: "#e9eef7", tag: "Daily notes" },
    { id: 9, name: "Blue Campus Mug", category: "Accessories", price: 5900, stock: 12, icon: "☕", sold: 0, color: "#edf1f5", tag: "Study break" }
];

const legacyDemoNames = ["Wireless Headphones", "Smart Watch", "Laptop Backpack", "Wireless Mouse", "Keyboard", "Portable Speaker"];
const storedProducts = readStore("products", null);
const isOldDemo = Array.isArray(storedProducts) && storedProducts.length > 0 &&
    storedProducts.every(product => legacyDemoNames.includes(product.name) && !product.category);
let products = !storedProducts || isOldDemo ? structuredClone(defaultProducts) : storedProducts.map(product => ({
    ...product,
    category: product.category || "Accessories",
    color: product.color || "#edf1f7",
    tag: product.tag || "KBTU collection"
}));
let orders = readStore("orders", []);
let cart = [];
let activeCategory = "All items";
let databaseConnected = false;

function readStore(key, fallback) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return value === null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function saveData() {
    localStorage.setItem("products", JSON.stringify(products));
    localStorage.setItem("orders", JSON.stringify(orders));
}

function money(value) {
    return Math.round(Number(value) || 0).toLocaleString("en-US");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
}

function showPage(pageId) {
    document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
    document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === pageId));
    if (pageId === "orders") renderOrders();
    if (pageId === "admin") renderAdmin();
    if (pageId === "dashboard") renderDashboard();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderCategoryFilters() {
    const categories = ["All items", ...new Set(products.map(product => product.category || "Accessories"))];
    if (!categories.includes(activeCategory)) activeCategory = "All items";
    const container = document.getElementById("category-filters");
    container.innerHTML = categories.map(category => `
        <button class="filter-chip ${category === activeCategory ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
    `).join("");
    container.querySelectorAll("[data-category]").forEach(button => {
        button.addEventListener("click", () => setCategory(button.dataset.category));
    });
}

function setCategory(category) {
    activeCategory = category;
    renderCategoryFilters();
    renderProducts();
}

function renderProducts() {
    const search = document.getElementById("search").value.trim().toLowerCase();
    const filtered = products.filter(product =>
        (activeCategory === "All items" || product.category === activeCategory) &&
        `${product.name} ${product.category}`.toLowerCase().includes(search)
    );
    document.getElementById("products").innerHTML = filtered.map(product => `
        <article class="product-card">
            <div class="product-image" style="--product-bg:${escapeHtml(product.color || "#edf1f7")}">
                <span class="product-tag">${escapeHtml(product.tag || product.category)}</span>
                ${product.imageUrl ? `<img class="product-photo" src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}">` : `<span class="product-emoji" aria-hidden="true">${escapeHtml(product.icon || "🎓")}</span>`}
            </div>
            <div class="product-meta"><div><h3>${escapeHtml(product.name)}</h3><p class="category-label">${escapeHtml(product.category || "Accessories")}</p></div><span class="product-price">${money(product.price)} ₸</span></div>
            <div class="product-bottom"><span class="stock-label ${product.stock < 5 ? "low" : ""}">${product.stock > 0 ? `${product.stock} available` : "Sold out"}</span>
                <button class="add-btn" onclick="addToCart(${Number(product.id)})" ${product.stock <= 0 ? "disabled" : ""}>Add to bag +</button></div>
        </article>
    `).join("") || '<p class="empty-state">No products match your search. Try another name or category.</p>';
}

async function loadProductsFromDatabase() {
    const status = document.getElementById("connection-status");
    try {
        const response = await fetch("/api/products");
        if (!response.ok) throw new Error("API response was not successful");
        const rows = await response.json();
        databaseConnected = true;
        products = rows.map(row => {
            const category = row.category || "Accessories";
            const categoryStyle = {
                Apparel: { icon: "🎓", color: "#e9edf5" },
                Accessories: { icon: "🎒", color: "#edf1f5" },
                Stationery: { icon: "📓", color: "#f4f0e7" }
            }[category] || { icon: "🎓", color: "#edf1f7" };
            return {
                id: Number(row.id), name: row.name, category,
                price: Number(row.price), stock: Number(row.stock), sold: 0,
                icon: categoryStyle.icon, color: categoryStyle.color,
                tag: "KBTU collection", imageUrl: row.image_url || ""
            };
        });
        status.textContent = `Connected to the database · ${products.length} products loaded`;
        status.className = "connection-status connected";
        renderCategoryFilters();
        renderProducts();
        await loadOrdersFromDatabase();
        if (document.getElementById("dashboard").classList.contains("active")) renderDashboard();
    } catch (error) {
        status.textContent = "Database is not connected yet · showing demo products";
        status.className = "connection-status offline";
    }
}

async function loadOrdersFromDatabase() {
    try {
        const response = await fetch("/api/orders");
        if (!response.ok) throw new Error("Could not load orders");
        orders = await response.json();
        if (document.getElementById("orders").classList.contains("active")) renderOrders();
        if (document.getElementById("admin").classList.contains("active")) renderAdmin();
        if (document.getElementById("dashboard").classList.contains("active")) renderDashboard();
    } catch (error) {
        console.error(error);
    }
}

function addToCart(id) {
    const product = products.find(item => item.id === id);
    const cartItem = cart.find(item => item.id === id);
    if (!product || (cartItem ? cartItem.quantity : 0) >= product.stock) {
        alert("There is not enough stock for that quantity.");
        return;
    }
    if (cartItem) cartItem.quantity++;
    else cart.push({ id, quantity: 1 });
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cart-items");
    let total = 0;
    let count = 0;
    const lines = cart.map(item => {
        const product = products.find(entry => entry.id === item.id);
        if (!product) return "";
        total += product.price * item.quantity;
        count += item.quantity;
        return `<div class="cart-item"><div><b>${escapeHtml(product.name)} × ${item.quantity}</b><p>${escapeHtml(product.category)}</p></div><b>${money(product.price * item.quantity)} ₸</b><button class="remove-btn" onclick="removeFromCart(${Number(item.id)})">Remove</button></div>`;
    });
    container.innerHTML = lines.join("") || '<p class="empty-panel">Your bag is waiting for something blue.</p>';
    document.getElementById("cart-total").textContent = money(total);
    document.getElementById("cart-count").textContent = count;
}

function removeFromCart(id) {
    cart = cart.filter(item => item.id !== id);
    renderCart();
}

async function checkout() {
    const name = document.getElementById("customer-name").value.trim();
    const email = document.getElementById("customer-email").value.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert("Please enter your name and a valid email address.");
        return;
    }
    if (!cart.length) {
        alert("Your bag is empty.");
        return;
    }
    for (const item of cart) {
        const product = products.find(entry => entry.id === item.id);
        if (!product || product.stock < item.quantity) {
            alert("Some items are no longer available in that quantity.");
            return;
        }
    }
    if (databaseConnected) {
        try {
            const response = await fetch("/api/orders", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerName: name, customerEmail: email, items: cart.map(item => ({ productId: item.id, quantity: item.quantity })) })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not place the order.");
            cart = [];
            renderCart();
            document.getElementById("customer-name").value = "";
            document.getElementById("customer-email").value = "";
            await loadProductsFromDatabase();
            await loadOrdersFromDatabase();
            alert(`Order saved to the database! Your order ID is ${result.id}`);
            showPage("orders");
            return;
        } catch (error) {
            alert(error.message || "Could not save the order.");
            return;
        }
    }
    let total = 0;
    const orderItems = cart.map(item => {
        const product = products.find(entry => entry.id === item.id);
        product.stock -= item.quantity;
        product.sold = (product.sold || 0) + item.quantity;
        total += product.price * item.quantity;
        return { name: product.name, category: product.category, quantity: item.quantity, price: product.price };
    });
    const order = {
        id: Date.now(), customer: name, email, items: orderItems, total,
        status: "Confirmed", date: new Date().toISOString()
    };
    orders.push(order);
    cart = [];
    saveData();
    renderCart();
    renderProducts();
    document.getElementById("customer-name").value = "";
    document.getElementById("customer-email").value = "";
    alert(`Order placed successfully! Your order ID is ${order.id}`);
    showPage("orders");
}

function displayDate(date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? String(date || "Date not recorded") : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function renderOrders() {
    const container = document.getElementById("order-list");
    if (!orders.length) {
        container.innerHTML = '<p class="empty-panel">No orders yet. Browse the collection and your purchases will appear here.</p>';
        return;
    }
    container.innerHTML = [...orders].reverse().map(order => `
        <div class="order-item"><div><h3>Order #${escapeHtml(order.id)}</h3><p>${escapeHtml(displayDate(order.date))} · ${escapeHtml(order.customer)}</p><p>${(order.items || []).map(item => `${escapeHtml(item.name)} × ${Number(item.quantity)}`).join(", ")}</p><p class="status">${escapeHtml(order.status)}</p></div><b class="order-total">${money(order.total)} ₸</b></div>
    `).join("");
}

function renderAdmin() {
    const revenue = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    document.getElementById("admin-orders").textContent = orders.length;
    document.getElementById("admin-revenue").textContent = money(revenue) + " ₸";
    document.getElementById("admin-products").textContent = products.length;
    document.getElementById("admin-low-stock").textContent = products.filter(product => product.stock < 5).length;
    document.getElementById("inventory-list").innerHTML = products.map(product => `
        <div class="inventory-item"><div><b>${escapeHtml(product.name)}</b><p>${escapeHtml(product.category)} · ${product.stock} in stock</p></div><div class="stock-controls"><button aria-label="Add one ${escapeHtml(product.name)}" onclick="changeStock(${Number(product.id)}, 1)">+1</button><button aria-label="Remove one ${escapeHtml(product.name)}" onclick="changeStock(${Number(product.id)}, -1)">−1</button></div></div>
    `).join("");
    document.getElementById("admin-order-list").innerHTML = orders.length ? [...orders].reverse().map(order => `
        <div class="order-item"><div><b>${escapeHtml(order.customer)}</b><p>Order #${escapeHtml(order.id)} · ${escapeHtml(displayDate(order.date))}</p><p>${money(order.total)} ₸</p></div><div class="stock-controls"><span class="status-badge">${escapeHtml(order.status)}</span><button class="status-btn" onclick="changeStatus(${Number(order.id)})">Next status →</button></div></div>
    `).join("") : '<p class="empty-panel">No customer orders yet.</p>';
}

async function changeStock(id, amount) {
    const product = products.find(entry => entry.id === id);
    if (product && product.stock + amount >= 0) {
        if (databaseConnected) {
            try {
                const response = await fetch(`/api/products/${id}/stock`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Could not update stock.");
                product.stock = Number(result.stock);
            } catch (error) { alert(error.message); return; }
        } else product.stock += amount;
        saveData();
        renderAdmin();
        renderProducts();
        if (document.getElementById("dashboard").classList.contains("active")) renderDashboard();
    }
}

async function addProduct() {
    const name = document.getElementById("new-name").value.trim();
    const category = document.getElementById("new-category").value;
    const price = Number(document.getElementById("new-price").value);
    const stock = Number(document.getElementById("new-stock").value);
    if (!name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
        alert("Enter a product name, a positive price and a valid stock quantity.");
        return;
    }
    const palette = { Apparel: "#e9edf5", Accessories: "#edf1f5", Stationery: "#f4f0e7" };
    if (databaseConnected) {
        try {
            const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, category, price, stock }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not add the product.");
            await loadProductsFromDatabase();
        } catch (error) { alert(error.message); return; }
    } else products.push({ id: Date.now(), name, category, price, stock, icon: "🎓", sold: 0, color: palette[category], tag: "KBTU collection" });
    saveData();
    document.getElementById("new-name").value = "";
    document.getElementById("new-price").value = "";
    document.getElementById("new-stock").value = "";
    renderAdmin();
    renderCategoryFilters();
    renderProducts();
}

async function changeStatus(id) {
    const order = orders.find(entry => entry.id === id);
    if (!order) return;
    const statuses = ["Confirmed", "Processing", "Shipped", "Delivered"];
    const index = statuses.indexOf(order.status);
    const nextStatus = statuses[(index + 1) % statuses.length];
    if (databaseConnected) {
        try {
            const response = await fetch(`/api/orders/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not update order status.");
            order.status = result.status;
        } catch (error) { alert(error.message); return; }
    } else order.status = nextStatus;
    saveData();
    renderAdmin();
    renderOrders();
}

function selectedOrders() {
    const days = document.getElementById("report-period").value;
    if (days === "all") return orders;
    const cutoff = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
    return orders.filter(order => {
        const date = new Date(order.date).getTime();
        return Number.isFinite(date) && date >= cutoff;
    });
}

function renderDashboard() {
    const periodOrders = selectedOrders();
    const revenue = periodOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const unitsInStock = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
    const average = periodOrders.length ? revenue / periodOrders.length : 0;
    const lowStock = products.filter(product => product.stock < 5);
    document.getElementById("bi-revenue").textContent = money(revenue) + " ₸";
    document.getElementById("bi-orders").textContent = periodOrders.length;
    document.getElementById("bi-average").textContent = money(average) + " ₸";
    document.getElementById("bi-stock").textContent = unitsInStock;
    document.getElementById("bi-low-stock-note").textContent = lowStock.length ? `${lowStock.length} product${lowStock.length === 1 ? "" : "s"} below 5 units` : "All products above low-stock level";

    const soldByName = new Map(products.map(product => [product.name, 0]));
    periodOrders.forEach(order => (order.items || []).forEach(item => {
        soldByName.set(item.name, (soldByName.get(item.name) || 0) + Number(item.quantity || 0));
    }));
    products.forEach(product => {
        if (!orders.some(order => (order.items || []).some(item => item.name === product.name))) {
            soldByName.set(product.name, Number(product.sold || 0));
        }
    });
    const maxSold = Math.max(1, ...soldByName.values());
    const ranked = [...products].sort((a, b) => (soldByName.get(b.name) || 0) - (soldByName.get(a.name) || 0));
    document.getElementById("sales-chart").innerHTML = ranked.length ? ranked.map(product => {
        const sold = soldByName.get(product.name) || 0;
        return `<div class="bar-row"><div class="bar-label"><span>${escapeHtml(product.name)}</span><b>${sold} sold</b></div><div class="bar-bg"><div class="bar" style="width:${sold / maxSold * 100}%"></div></div></div>`;
    }).join("") : '<p class="empty-chart">Add products to see sales here.</p>';

    const categoryUnits = new Map();
    products.forEach(product => categoryUnits.set(product.category, (categoryUnits.get(product.category) || 0) + (soldByName.get(product.name) || 0)));
    const totalCategoryUnits = [...categoryUnits.values()].reduce((sum, value) => sum + value, 0);
    document.getElementById("category-chart").innerHTML = [...categoryUnits].map(([category, units]) => `
        <div class="category-row"><span>${escapeHtml(category)}</span><div class="category-track"><div class="category-fill" style="width:${totalCategoryUnits ? units / totalCategoryUnits * 100 : 0}%"></div></div><b>${units}</b></div>
    `).join("") || '<p class="empty-chart">No categories to show.</p>';

    const topSeller = ranked.find(product => (soldByName.get(product.name) || 0) > 0);
    const insights = [
        `<b>${periodOrders.length} order${periodOrders.length === 1 ? "" : "s"}</b> recorded in the selected period, generating <b>${money(revenue)} ₸</b> in sales.`,
        topSeller ? `<b>${escapeHtml(topSeller.name)}</b> leads the collection with ${soldByName.get(topSeller.name)} unit${soldByName.get(topSeller.name) === 1 ? "" : "s"} sold.` : "No sales recorded for this period yet. Your first order will reveal what customers like.",
        lowStock.length ? `<b>Restock attention:</b> ${lowStock.map(product => escapeHtml(product.name)).join(", ")} ${lowStock.length === 1 ? "has" : "have"} fewer than 5 units left.` : "<b>Inventory looks healthy:</b> no products are below the 5-unit alert level."
    ];
    document.getElementById("insights").innerHTML = `<ul class="insight-list">${insights.map((insight, index) => `<li><span class="insight-icon">${["↗", "✦", "! "][index]}</span><span>${insight}</span></li>`).join("")}</ul>`;
    updateDSS();
}

function updateDSS() {
    const slider = document.getElementById("demand");
    if (!slider) return;
    const demand = Number(slider.value);
    document.getElementById("demand-value").textContent = demand;
    const candidates = products.map(product => {
        const sold = Number(product.sold || 0);
        const projectedNeed = Math.ceil(sold * (1 + demand / 100));
        const suggested = Math.max(0, projectedNeed - product.stock);
        return { product, projectedNeed, suggested };
    }).filter(row => row.suggested > 0).sort((a, b) => b.suggested - a.suggested);
    document.getElementById("dss-result").innerHTML = candidates.length
        ? candidates.slice(0, 5).map(({ product, projectedNeed, suggested }) => `<div class="dss-item"><span><b>${escapeHtml(product.name)}</b><br>Projected demand: ${projectedNeed}</span><span>Restock <b>+${suggested}</b></span></div>`).join("")
        : '<p class="dss-ok">Current stock covers projected demand based on recorded sales. New sales will make this estimate more useful.</p>';
}

renderCategoryFilters();
renderProducts();
renderCart();
loadProductsFromDatabase();
