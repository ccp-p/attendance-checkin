/*
 * Accessibility Watchdog
 * Function:
 * - Record enabled_accessibility_services on first startup
 * - Periodically check if it has been removed
 * - If disabled, automatically add it back
 * Requirement:
 *  - WRITE_SECURE_SETTINGS permission (via Shizuku)
 *  - Enable all accessibility services you want to keep enabled before starting this script
 */

// console.show();

// ===== Configurable parameters =====
var CHECK_INTERVAL = 10000; // ms

// ===== Storage =====
var store = storages.create("accessibility_watchdog");
store.clear();

// ===== Java class path =====
var Settings = android.provider.Settings;
var resolver = context.getContentResolver();

// ===== Get enabled services =====
function getEnabledServices() {
    var value = Settings.Secure.getString(
        resolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    );

    if (!value) return [];

    var arr = value.split(":");
    var out = [];

    for (var i = 0; i < arr.length; i++) {
        if (arr[i]) out.push(arr[i]);
    }

    return out;
}

// ===== Set enabled services =====
function setEnabledServices(list) {
    Settings.Secure.putString(
        resolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        list.join(":")
    );

    Settings.Secure.putInt(
        resolver,
        Settings.Secure.ACCESSIBILITY_ENABLED,
        1
    );
}

// ===== Initialize baseline =====
function initBaseline() {
    var baseline = store.get("baseline");

    if (!baseline) {
        baseline = getEnabledServices();
        store.put("baseline", baseline);
        console.info("Accessibility services baseline initialized: " + baseline);
    }

    return baseline;
}

// ===== Contains =====
function contains(arr, v) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === v) return true;
    }
    return false;
}

// ===== Watchdog =====
function watchdog() {
    var baseline = initBaseline() || [];
    var current = getEnabledServices();
    var changed = false;

    for (var i = 0; i < baseline.length; i++) {
        if (!contains(current, baseline[i])) {
            console.warn("Service disabled found: " + baseline[i]);
            current.push(baseline[i]);
            changed = true;
        }
    }

    if (changed) {
        setEnabledServices(current);
        console.warn("accessibility services recovered");
    }
}

// ===== Main =====
console.info("Accessibility watchdog started (interval=" + CHECK_INTERVAL + "ms)");
setInterval(function () {
    watchdog();
}, CHECK_INTERVAL);
