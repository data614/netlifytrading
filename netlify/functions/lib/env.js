const TIINGO_TOKEN_CANDIDATE_KEYS = [
    // Common server-side names
    "TIINGO_KEY",
    "TIINGO_API_KEY",
    "TIINGO_TOKEN",
    "TIINGO_API_TOKEN",
    "TIINGO_ACCESS_TOKEN",

    // Create React App style
    "REACT_APP_TIINGO_TOKEN",
    "REACT_APP_TIINGO_API_KEY",
    "REACT_APP_TIINGO_KEY",

    // Gatsby & Next.js style
    "GATSBY_TIINGO_TOKEN",
    "GATSBY_TIINGO_KEY",
    "NEXT_PUBLIC_TIINGO_TOKEN",
    "NEXT_PUBLIC_TIINGO_API_KEY",

    // Vite style
    "VITE_TIINGO_TOKEN",
    "VITE_TIINGO_API_KEY",
    "VITE_TIINGO_KEY",
];

const isTokenLike = (value) => {
    if (typeof value !== 'string') {
        return false;
    }
    return value.length >= 24 && value.length <= 64 && /^[a-zA-Z0-9]+$/.test(value);
};

const getTiingoTokenDetail = () => {
    const allKeys = [...TIINGO_TOKEN_CANDIDATE_KEYS, ...TIINGO_TOKEN_CANDIDATE_KEYS.map(k => k.toLowerCase())];

    // 1. Check preferred keys
    for (const key of allKeys) {
        if (process.env[key]) {
            return { token: process.env[key], key, reason: "found in standard env var" };
        }
    }

    // 2. Scan all environment variable values
    for (const [key, value] of Object.entries(process.env)) {
        if (isTokenLike(value)) {
            return { token: value, key, reason: "found by scanning env var values" };
        }
    }

    // 3. Check if a token was used as a key
    for (const key of Object.keys(process.env)) {
        if (isTokenLike(key)) {
            return { token: key, key, reason: "found in env var name" };
        }
    }

    return { token: null, key: null, reason: "not found" };
};

const getTiingoToken = () => {
    return getTiingoTokenDetail().token;
}

// Additional exports for compatibility with existing functions
const TIINGO_TOKEN_ENV_KEYS = TIINGO_TOKEN_CANDIDATE_KEYS;

const isEnvPresent = (key) => {
    return typeof process.env[key] === 'string' && process.env[key].trim() !== '';
};

export {
    getTiingoToken,
    getTiingoTokenDetail,
    TIINGO_TOKEN_CANDIDATE_KEYS,
    TIINGO_TOKEN_ENV_KEYS,
    isEnvPresent
};