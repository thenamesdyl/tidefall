import * as THREE from 'three';
import { getAuth } from 'firebase/auth';
import { showLoginScreen } from './main';
import { setPlayerStateFromDb, getPlayerStateFromDb } from './gameState';
import { setupAllPlayersTracking } from './main';

// Network configuration
//const SERVER_URL = 'http://localhost:5001';
const SERVER_URL = 'https://boat-game-python.onrender.com';

// Network state
export let socket;
let playerId;
let firebaseDocId = null; // Store Firebase User ID globally in the module
let otherPlayers = new Map(); // Map to store other players' meshes
let isConnected = false;
let playerName = "Sailor_" + Math.floor(Math.random() * 1000);
let playerColor;
let playerStats = {
    fishCount: 0,
    monsterKills: 0,
    money: 0
};

// Chat system variables
let chatMessageCallback = null;
let recentMessagesCallback = null;
let messageHistory = [];
const DEFAULT_MESSAGE_LIMIT = 50;

// Reference to scene and game objects (to be set from script.js)
let sceneRef;
let playerStateRef;
let boatRef;
let character;
let islandCollidersRef;
let activeIslandsRef;

// Callback for 'all_players' event
let allPlayersCallback = null;

// Register a callback for when player list is updated
export function onAllPlayers(callback) {
    allPlayersCallback = callback;

    // Register the socket listener if it doesn't exist
    console.log('Setting up all_players listener');

    if (socket) {
        console.log('Setting up all_players listener');
        socket.on('all_players', (players) => {
            console.log('Received all players list:', players.length);

            // Add player stats if available
            players.forEach(player => {
                // Try to get stored stats for this player from cache
                if (otherPlayers.has(player.id)) {
                    const storedPlayer = otherPlayers.get(player.id);
                    if (storedPlayer.data && storedPlayer.data.stats) {
                        player.stats = storedPlayer.data.stats;
                    }
                }
            });

            // Call the registered callback
            if (allPlayersCallback) {
                allPlayersCallback(players);
            }
        });
    }
}

// Request the player list from the server
export function getAllPlayers() {
    if (isConnected && socket) {
        console.log('Requesting all players from server');
        socket.emit('get_all_players');
        return true;
    }
    return false;
}

// Export a getter for the player name
export function getPlayerName() {
    console.log("getPlayerName called, returning:", playerName);
    return playerName;
}

// Initialize the network connection
export async function initializeNetwork(
    scene,
    playerState,
    boat,
    islandColliders,
    activeIslands,
    name,
    color,
    userId = null // Firebase UID
) {
    console.log("NETWORK INIT STARTING");

    // Store references to game objects
    sceneRef = scene;
    playerStateRef = playerState;
    boatRef = boat;
    islandCollidersRef = islandColliders;
    activeIslandsRef = activeIslands;
    playerName = name;
    playerColor = color;

    // Store the Firebase user ID
    console.log("Initializing network with Firebase UID:", userId);

    console.log(`Initializing network with user ID: ${userId || 'anonymous'}`);

    // Apply the player's color to their own boat
    applyColorToBoat(boat, playerColor);

    // Initialize Socket.IO connection
    socket = io(SERVER_URL);

    // Add this line to make socket globally available
    window.socket = socket;  // Make socket available on window for other components

    // Set up event handlers
    setupSocketEvents();

    // Get the Firebase auth token if using Firebase
    let firebaseToken = null;
    if (userId) {
        try {
            const auth = getAuth();
            firebaseToken = await auth.currentUser.getIdToken();
            console.log("Firebase token acquired successfully");
        } catch (error) {
            console.error("Failed to get Firebase token:", error);
        }
    }

    console.log('Connecting to game server...');

    // Once connected, we'll send the player_join event
    socket.on('connect', () => {
        console.log('Connected to game server, sending player data');
        isConnected = true;

        // CRUCIAL FIX: Get the current Firebase UID value at connection time
        // This ensures we're using the most up-to-date value
        console.log(`Current Firebase UID at connection time: ${firebaseDocId}`);

        // Send player data with the token to authenticate
        socket.emit('player_join', {
            name: playerName,
            color: playerColor,
            position: boatRef.position,
            rotation: boatRef.rotation.y,
            mode: playerStateRef.mode,
            player_id: userId,      // Use module-scoped variable
            firebaseToken: firebaseToken   // Use module-scoped variable
        });
    });

    firebaseDocId = "firebase_" + userId;
}

// Helper function to apply color to a boat
function applyColorToBoat(boatMesh, color) {
    // Initialize texture if needed (first time function is called)
    if (!window.boatTextureCache) {
        createBoatTextures();
    }

    // Find the hull in the boat group
    boatMesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
            // Only change color if it's NOT flagged as not player colorable
            if (child.material && !child.userData.isNotPlayerColorable) {
                // Create a new material with the player's color and texture
                const newMaterial = new THREE.MeshPhongMaterial({
                    color: new THREE.Color(color.r, color.g, color.b),
                    map: window.boatTextureCache.imperfectionMap,
                    bumpMap: window.boatTextureCache.bumpMap,
                    bumpScale: 0.02,
                    shininess: 40, // Slightly glossy finish
                    specular: new THREE.Color(0x333333) // Subtle specular highlights
                });

                child.material = newMaterial;
            }
        }
    });
}

// Create textures for boat materials (called once)
function createBoatTextures() {
    // Create cache object for textures
    window.boatTextureCache = {};

    // Create a canvas for the imperfection texture
    const impCanvas = document.createElement('canvas');
    impCanvas.width = 512;
    impCanvas.height = 512;
    const impCtx = impCanvas.getContext('2d');

    // Fill with nearly transparent white (allows color to show through)
    impCtx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    impCtx.fillRect(0, 0, impCanvas.width, impCanvas.height);

    // Add subtle scratches and imperfections
    impCtx.strokeStyle = 'rgba(0, 0, 0, 0.1)';

    // Add random scratches
    for (let i = 0; i < 30; i++) {
        impCtx.lineWidth = 0.5 + Math.random() * 1.5;
        impCtx.beginPath();
        const x1 = Math.random() * impCanvas.width;
        const y1 = Math.random() * impCanvas.height;
        const length = 10 + Math.random() * 40;
        const angle = Math.random() * Math.PI * 2;
        impCtx.moveTo(x1, y1);
        impCtx.lineTo(
            x1 + Math.cos(angle) * length,
            y1 + Math.sin(angle) * length
        );
        impCtx.stroke();
    }

    // Add some subtle noise/grain
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * impCanvas.width;
        const y = Math.random() * impCanvas.height;
        const size = 1 + Math.random() * 2;
        impCtx.fillStyle = `rgba(0, 0, 0, ${0.03 + Math.random() * 0.05})`;
        impCtx.fillRect(x, y, size, size);
    }

    // Create the imperfection texture
    const imperfectionMap = new THREE.CanvasTexture(impCanvas);
    imperfectionMap.wrapS = THREE.RepeatWrapping;
    imperfectionMap.wrapT = THREE.RepeatWrapping;
    window.boatTextureCache.imperfectionMap = imperfectionMap;

    // Create bump map for surface detail
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bumpCtx = bumpCanvas.getContext('2d');

    // Fill with middle gray (neutral bump)
    bumpCtx.fillStyle = 'rgb(128, 128, 128)';
    bumpCtx.fillRect(0, 0, bumpCanvas.width, bumpCanvas.height);

    // Add wood-like grain for bump
    for (let i = 0; i < 15; i++) {
        const y = i * (bumpCanvas.height / 15) + (Math.random() * 10 - 5);
        bumpCtx.strokeStyle = `rgb(${100 + Math.random() * 30}, ${100 + Math.random() * 30}, ${100 + Math.random() * 30})`;
        bumpCtx.lineWidth = 2 + Math.random() * 3;

        bumpCtx.beginPath();
        bumpCtx.moveTo(0, y);

        const segments = 8;
        const xStep = bumpCanvas.width / segments;

        for (let j = 1; j <= segments; j++) {
            const x = j * xStep;
            const yOffset = (Math.random() - 0.5) * 15;
            bumpCtx.lineTo(x, y + yOffset);
        }

        bumpCtx.stroke();
    }

    // Create the bump texture
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    window.boatTextureCache.bumpMap = bumpMap;
}

// Set up Socket.IO event handlers
function setupSocketEvents() {
    // Skip connect handler as we'll handle it in initializeNetwork

    socket.on('disconnect', () => {
        console.log('Disconnected from game server');
        isConnected = false;

        // Clean up other players
        otherPlayers.forEach((player, id) => {
            removeOtherPlayerFromScene(id);
        });
    });

    socket.on('connection_response', (data) => {
        console.log('Connection established, player ID:', data.id);

        // Important: The server will now send back the Firebase UID as the player ID
        // if authentication was successful
        playerId = data.id;

        // This may be different from the socket ID now - it could be the Firebase UID

        if (!data.name) {
            showLoginScreen();
        }

        console.log("setting player data ", data);
        setPlayerStateFromDb(data);

        setupAllPlayersTracking();


        // Example usage in game code

        console.log("Getting player inventory");
        getPlayerInventory((inventory) => {
            console.log('Inventory:', inventory);
            if (inventory) {
                console.log('My fish collection:', inventory.fish);
                console.log('My treasures:', inventory.treasures);

                // Check if player has a specific item
                if (playerHasItem(inventory, 'fish', 'Rare Tuna')) {
                    console.log('You have a Rare Tuna!');
                }
            }
        });


        // IMPORTANT FIX: Update the playerName variable with the server-stored name
        // This ensures clan tags are maintained after page reload
        if (data.name) {
            console.log("Updating player name from server data:", data.name);
            playerName = data.name; // Update the local variable directly with server data
        }

        // Register islands
        registerIslands();

        // Initialize player stats from server
        initializePlayerStats();

        // Request all current players (as a backup in case the automatic all_players event wasn't received)
        socket.emit('get_all_players');

        // Request initial chat messages
        // requestInitialMessages();
    });

    // Handle receiving all current players
    socket.on('all_players', (players) => {
        console.log('Received all players:', players.length);

        // Add each player to the scene (except ourselves)
        players.forEach(playerData => {
            if (playerData.id !== playerId) {
                addOtherPlayerToScene(playerData);
            }
        });
    });

    // Player events
    socket.on('player_joined', (data) => {
        console.log('New player joined:', data.name);
        if (data.id !== playerId) {
            addOtherPlayerToScene(data);
        }
    });

    socket.on('player_moved', (data) => {
        if (data.id !== playerId) {
            updateOtherPlayerPosition(data);
        }
    });

    socket.on('player_updated', (data) => {
        if (data.id !== playerId) {
            updateOtherPlayerInfo(data);
        }
    });

    socket.on('player_disconnected', (data) => {
        console.log('Player disconnected:', data.id);
        removeOtherPlayerFromScene(data.id);
    });

    // Island events
    socket.on('island_registered', (data) => {
        // This could be used to sync islands across clients
        console.log('Island registered:', data.id);
    });

    // Leaderboard events
    socket.on('leaderboard_update', (data) => {
        console.log('Received leaderboard update:', data);

        // Update the UI with new leaderboard data
        if (typeof updateLeaderboardData === 'function') {
            updateLeaderboardData(data);
        } else {
            console.warn('updateLeaderboardData function not available');
        }
    });

    // Add this handler to process the player stats response
    socket.on('player_stats', (data) => {
        console.log('Received player stats from server:', data);

        // Update local player stats
        if (data.fishCount !== undefined) {
            playerStats.fishCount = data.fishCount;
        }
        if (data.monsterKills !== undefined) {
            playerStats.monsterKills = data.monsterKills;
        }
        if (data.money !== undefined) {
            playerStats.money = data.money;
        }

        // Update UI if gameUI exists
        if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
            window.gameUI.updatePlayerStats();
        }
    });

    // Chat events
    socket.on('new_message', (data) => {
        console.log('CHAT DEBUG: Received raw message data:', data);
        console.log('CHAT DEBUG: Data type:', typeof data);

        // Handle string messages (backwards compatibility)
        if (typeof data === 'string') {
            console.log('CHAT DEBUG: Received string message - converting to object');
            data = {
                content: data,
                timestamp: Date.now(),
                sender_name: 'Unknown Sailor'
            };
        } else if (data && typeof data === 'object') {
            console.log('CHAT DEBUG: Received object message with fields:', Object.keys(data));

            // Check if data has required fields
            if (!data.content) {
                console.error('CHAT DEBUG: Message missing content field!', data);
            }

            if (!data.sender_name) {
                console.log('CHAT DEBUG: Message missing sender_name field');

                // If this is our own message and it's missing the sender name
                if (data.player_id === firebaseDocId) {
                    console.log('CHAT DEBUG: This is our own message, using our name');
                    data.sender_name = playerName;
                }
                // If it's from another player, try to get their name from our local cache
                else if (data.player_id && otherPlayers.has(data.player_id)) {
                    const otherPlayer = otherPlayers.get(data.player_id);
                    if (otherPlayer && otherPlayer.name) {
                        data.sender_name = otherPlayer.name;
                        console.log('CHAT DEBUG: Using name from other players cache:', data.sender_name);
                    } else {
                        data.sender_name = 'Unknown Sailor';
                        console.log('CHAT DEBUG: Other player found but no name available, using default');
                    }
                }
                // Last resort - use default name
                else {
                    data.sender_name = 'Unknown Sailor';
                    console.log('CHAT DEBUG: No sender information available, using default name');
                }
            } else {
                console.log('CHAT DEBUG: Message has sender_name:', data.sender_name);
            }
        } else {
            console.error('CHAT DEBUG: Received invalid message data type:', data);
            return; // Skip processing invalid data
        }

        // Ensure timestamp exists
        if (!data.timestamp) {
            data.timestamp = Date.now();
        }

        console.log('CHAT DEBUG: Final processed message:', data);

        // Add to message history
        messageHistory.push(data);

        // Trim history if it gets too long (keep last 100 messages in memory)
        if (messageHistory.length > 100) {
            messageHistory = messageHistory.slice(-100);
        }

        // Notify UI if callback is registered
        if (chatMessageCallback) {
            console.log('CHAT DEBUG: Calling UI callback with message data');
            chatMessageCallback(data);
        } else {
            console.log('CHAT DEBUG: No UI callback registered for messages');
        }
    });

    socket.on('recent_messages', (data) => {
        console.log('Received recent messages:', data.messages.length);

        // Replace message history with recent messages (sorted chronologically)
        messageHistory = data.messages.sort((a, b) => a.timestamp - b.timestamp);

        // Notify UI if callback is registered
        if (recentMessagesCallback) {
            recentMessagesCallback(messageHistory);
        }
    });
}

// Send player position update to the server
export function updatePlayerPosition() {
    if (!isConnected || !socket || !playerId) return;

    // Get the active object (boat or character)
    const activeObject = playerStateRef.mode === 'boat' ? boatRef : character;

    socket.emit('update_position', {
        x: activeObject.position.x,
        y: activeObject.position.y,
        z: activeObject.position.z,
        rotation: activeObject.rotation.y,
        mode: playerStateRef.mode,
        player_id: firebaseDocId
    });
}

// Set the player's name
export function setPlayerName(name) {
    console.log("setPlayerName called with new name:", name);
    console.log("Previous player name was:", playerName);

    // Safety check - don't allow empty names
    if (!name || name.trim() === '') {
        console.error("ERROR: Attempted to set empty player name. Ignoring request.");
        return;
    }

    playerName = name;
    console.log("Player name updated to:", playerName);

    if (isConnected && socket) {
        console.log("Sending update_player_name to server with:", { name: playerName, player_id: firebaseDocId });
        socket.emit('update_player_name', { name: playerName, player_id: firebaseDocId });
    } else {
        console.warn("Not connected to server, player name update not sent");
    }
}

export function setPlayerColor(color) {
    playerColor = color;

    if (isConnected && socket) {
        socket.emit('update_player_color', { color: playerColor, player_id: firebaseDocId });
    }
}

// Register islands with the server
function registerIslands() {
    if (!isConnected || !socket) return;

    // Register each island with the server
    islandCollidersRef.forEach(collider => {
        socket.emit('register_island', {
            id: collider.id,
            x: collider.center.x,
            y: collider.center.y,
            z: collider.center.z,
            radius: collider.radius,
            type: activeIslandsRef.get(collider.id)?.type || 'default',
            player_id: firebaseDocId
        });
    });
}

// Add another player to the scene
function addOtherPlayerToScene(playerData) {
    // Skip if this player is already in the scene
    if (otherPlayers.has(playerData.id)) return;

    // Create a mesh for the other player
    let playerMesh;

    if (playerData.mode === 'boat') {
        // Create a boat mesh (simplified version of the main boat)
        playerMesh = new THREE.Group();

        const hullGeometry = new THREE.BoxGeometry(2, 1, 4);

        // Use the player's color for the hull if available
        const hullColor = playerData.color ?
            new THREE.Color(playerData.color.r, playerData.color.g, playerData.color.b) :
            new THREE.Color(0x885533);

        const hullMaterial = new THREE.MeshPhongMaterial({ color: hullColor });
        const hull = new THREE.Mesh(hullGeometry, hullMaterial);
        hull.position.y = 0.5;
        playerMesh.add(hull);

        const mastGeometry = new THREE.CylinderGeometry(0.1, 0.1, 3);
        const mastMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 });
        const mast = new THREE.Mesh(mastGeometry, mastMaterial);
        mast.position.y = 2;
        playerMesh.add(mast);
    } else {
        // Create a character mesh
        const characterGeometry = new THREE.BoxGeometry(1, 2, 1);

        // Use the player's color for the character if available
        const characterColor = playerData.color ?
            new THREE.Color(playerData.color.r, playerData.color.g, playerData.color.b) :
            new THREE.Color(0x2288cc);

        const characterMaterial = new THREE.MeshPhongMaterial({ color: characterColor });
        playerMesh = new THREE.Mesh(characterGeometry, characterMaterial);
    }

    // Add player name label
    const nameCanvas = document.createElement('canvas');
    const nameContext = nameCanvas.getContext('2d');
    nameCanvas.width = 256;
    nameCanvas.height = 64;
    nameContext.font = '24px Arial';
    nameContext.fillStyle = 'white';
    nameContext.textAlign = 'center';
    nameContext.fillText(playerData.name, 128, 32);

    const nameTexture = new THREE.CanvasTexture(nameCanvas);
    const nameMaterial = new THREE.SpriteMaterial({ map: nameTexture });
    const nameSprite = new THREE.Sprite(nameMaterial);
    nameSprite.position.y = 3;
    nameSprite.scale.set(5, 1.25, 1);
    playerMesh.add(nameSprite);

    // Add a vertical, thin, bright yellow light that follows the player
    const lightHeight = 10000; // Adjust the height of the light
    const lightGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, lightHeight, 0)
    ]);

    const lightColor = playerData.color ?
        new THREE.Color(playerData.color.r, playerData.color.g, playerData.color.b) :
        new THREE.Color(0xffff00); // Default to bright yellow if no color is provided
    const lightMaterial = new THREE.LineBasicMaterial({
        color: lightColor, // Bright yellow
        linewidth: 1 // Adjust the width of the line
    });
    const lightLine = new THREE.Line(lightGeometry, lightMaterial);
    lightLine.position.y = playerData.mode === 'boat' ? 1 : 1; // Adjust height based on player mode
    playerMesh.add(lightLine);


    // Add a point light for additional visibility
    const pointLight = new THREE.PointLight(0xffffff, 0.5, 10); // Adjust intensity and distance as needed
    pointLight.position.y = playerData.mode === 'boat' ? 1 : 1; // Adjust height based on player mode
    playerMesh.add(pointLight);

    // Position the player
    playerMesh.position.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
    );
    playerMesh.rotation.y = playerData.rotation;

    // Add to scene
    sceneRef.add(playerMesh);

    // Store in otherPlayers map
    otherPlayers.set(playerData.id, {
        mesh: playerMesh,
        data: playerData,
        nameSprite: nameSprite
    });
}

// Update another player's position
function updateOtherPlayerPosition(playerData) {
    const player = otherPlayers.get(playerData.id);
    if (!player) return;

    // Check if mode has changed
    if (player.data.mode !== playerData.mode) {
        // Remove old mesh and create a new one with the correct mode
        removeOtherPlayerFromScene(playerData.id);
        addOtherPlayerToScene(playerData);
        return;
    }

    // Update position and rotation
    player.mesh.position.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
    );
    player.mesh.rotation.y = playerData.rotation;

    // Update stored data
    player.data = {
        ...player.data,
        position: playerData.position,
        rotation: playerData.rotation,
        mode: playerData.mode
    };
}

// Update another player's information (like name)
function updateOtherPlayerInfo(playerData) {
    const player = otherPlayers.get(playerData.id);
    if (!player) return;

    // Update name if provided
    if (playerData.name && player.data.name !== playerData.name) {
        player.data.name = playerData.name;

        // Update name sprite
        const nameCanvas = document.createElement('canvas');
        const nameContext = nameCanvas.getContext('2d');
        nameCanvas.width = 256;
        nameCanvas.height = 64;
        nameContext.font = '24px Arial';
        nameContext.fillStyle = 'white';
        nameContext.textAlign = 'center';
        nameContext.fillText(playerData.name, 128, 32);

        const nameTexture = new THREE.CanvasTexture(nameCanvas);
        player.nameSprite.material.map = nameTexture;
        player.nameSprite.material.needsUpdate = true;
    }

    // Update color if provided
    if (playerData.color && player.data.mode === 'boat') {
        player.data.color = playerData.color;

        // Find the hull in the boat group and update its color
        player.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry) {
                // This is likely the hull
                if (child.material) {
                    child.material.color.setRGB(
                        playerData.color.r,
                        playerData.color.g,
                        playerData.color.b
                    );
                    child.material.needsUpdate = true;
                }
            }
        });
    }
}

// Remove another player from the scene
function removeOtherPlayerFromScene(playerId) {
    const player = otherPlayers.get(playerId);
    if (!player) return;

    // Remove from scene
    sceneRef.remove(player.mesh);

    // Remove from map
    otherPlayers.delete(playerId);
}

// Disconnect from the server
export function disconnect() {
    if (socket) {
        socket.disconnect();
    }
}

// Get the number of connected players
export function getConnectedPlayersCount() {
    return otherPlayers.size + 1; // +1 for the local player
}

// Check if connected to the server
export function isNetworkConnected() {
    return isConnected;
}

// Request leaderboard data from the server
export function requestLeaderboard() {
    if (!isConnected || !socket) return;

    console.log('Requesting leaderboard data...');
    socket.emit('get_leaderboard', { player_id: firebaseDocId });
}

// Update player stats
export function updatePlayerStats(stats) {
    if (!isConnected || !socket) return;

    // Update local stats
    if (stats.fishCount !== undefined) {
        playerStats.fishCount = stats.fishCount;
    }
    if (stats.monsterKills !== undefined) {
        playerStats.monsterKills = stats.monsterKills;
    }
    if (stats.money !== undefined) {
        playerStats.money = stats.money;
    }

    // Send update to server
    console.log('Updating player stats:', stats);
    socket.emit('player_action', {
        action: 'update_stats',
        stats: stats,
        player_id: firebaseDocId
    });

    // Update UI if gameUI exists
    if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
        window.gameUI.updatePlayerStats();
    }
}

// Increment player stats (more convenient for individual updates)
export function incrementPlayerStats(stats) {
    if (!isConnected || !socket) return;

    // Update local stats
    if (stats.fishCount) {
        playerStats.fishCount += stats.fishCount;
    }
    if (stats.monsterKills) {
        playerStats.monsterKills += stats.monsterKills;
    }
    if (stats.money) {
        playerStats.money += stats.money;
    }

    updatePlayerStats(playerStats);

    // Send the complete updated stats to server
    console.log('Incrementing player stats:', stats);
    socket.emit('player_action', {
        action: 'update_stats',
        stats: playerStats,
        player_id: firebaseDocId
    });

    // Update UI if gameUI exists
    if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
        window.gameUI.updatePlayerStats();
    }
}

// Get current player stats
export function getPlayerStats() {
    return { ...playerStats };
}

// Call this when a player catches a fish
export function onFishCaught(value = 1) {
    if (!isConnected || !socket) return;

    // Update local stats
    playerStats.fishCount += value;

    console.log(`Fish caught! New count: ${playerStats.fishCount}`);

    // Send the fish caught action to server
    socket.emit('player_action', {
        action: 'fish_caught',
        value: value,
        player_id: firebaseDocId
    });

    // Update UI
    if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
        window.gameUI.updatePlayerStats();
    }
}

// Call this when a player kills a monster
export function onMonsterKilled(value = 1) {
    if (!isConnected || !socket) return;

    // Update local stats
    playerStats.monsterKills += value;

    console.log(`Monster killed! New count: ${playerStats.monsterKills}`);

    // Send the monster killed action to server
    socket.emit('player_action', {
        action: 'monster_killed',
        value: value,
        player_id: firebaseDocId
    });

    // Update UI
    if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
        window.gameUI.updatePlayerStats();
    }
}

// Call this when a player earns money
export function onMoneyEarned(value) {
    if (!isConnected || !socket) return;

    // Update local stats
    playerStats.money += value;

    console.log(`Money earned! New amount: ${playerStats.money}`);

    // Send the money earned action to server
    socket.emit('player_action', {
        action: 'money_earned',
        value: value,
        player_id: firebaseDocId
    });

    // Update UI
    if (window.gameUI && typeof window.gameUI.updatePlayerStats === 'function') {
        window.gameUI.updatePlayerStats();
    }
}

// Add this new function to initialize player stats
function initializePlayerStats() {
    if (!isConnected || !socket || !playerId) return;

    console.log('Initializing player stats from server...');

    // Request player stats from server
    socket.emit('get_player_stats', { id: playerId, player_id: firebaseDocId });
}

// Send a chat message
export function sendChatMessage(content, messageType = 'global') {
    try {
        // First check for socket connection
        if (!isConnected || !socket) {
            console.error("Cannot send message - not connected to server");
            return false;
        }

        // Log current state
        console.log('Attempt to send chat message:', content);
        console.log('Connection status:', isConnected ? 'Connected' : 'Disconnected');
        console.log('Current player ID:', playerId);
        console.log('Current Firebase doc ID:', firebaseDocId);
        console.log('Current player name:', playerName);

        // Ensure we have a valid player ID
        // Try to get it from different sources if not available
        if (!playerId && socket && socket.id) {
            // If no player ID but we have a socket ID, use that temporarily
            console.log('No player ID found, using socket ID temporarily');
            playerId = socket.id;
        }

        // Make sure firebaseDocId is properly set
        if (!firebaseDocId && playerId) {
            // If we have playerId but no firebaseDocId, set it
            console.log('Setting firebaseDocId from playerId:', playerId);
            firebaseDocId = playerId.startsWith('firebase_') ?
                playerId : 'firebase_' + playerId;
        } else if (!firebaseDocId) {
            // Last resort - create a temporary ID
            console.error('No player ID available, using temporary ID');
            const tempId = 'firebase_temp_' + Math.floor(Math.random() * 10000);
            firebaseDocId = tempId;
            playerId = tempId.replace('firebase_', '');
        }

        // Ensure the firebaseDocId is correctly formatted
        if (!firebaseDocId.startsWith('firebase_')) {
            firebaseDocId = 'firebase_' + firebaseDocId;
            console.log('Fixed Firebase doc ID format:', firebaseDocId);
        }

        // IMPORTANT: DON'T send a player_name field at all
        // Let the server use what it has in its cache
        // This ensures consistency between nick changes and chat
        console.log('Sending chat message with player_id:', firebaseDocId);
        console.log('NOT sending player_name - using server cache instead');

        // Create the message object WITHOUT the player_name field
        const messageObj = {
            content: content,
            type: messageType,
            player_id: firebaseDocId
            // Removed player_name field to let server use its cached value
        };

        // Log the complete message object being sent
        console.log('Sending complete message object:', messageObj);

        // Now send the message
        socket.emit('send_message', messageObj);

        console.log('Message emitted without player_name to ensure server cache is used');
        console.log('Message emitted successfully');
        return true;
    } catch (error) {
        console.error('Error sending chat message:', error);
        return false;
    }
}

// Request recent messages from the server
export function getRecentMessages(messageType = 'global', limit = DEFAULT_MESSAGE_LIMIT) {
    if (!isConnected || !socket) return false;

    console.log('Requesting recent messages...');

    socket.emit('get_recent_messages', {
        type: messageType,
        limit: limit,
        player_id: firebaseDocId
    });

    return true;
}

// Register a callback function to be called when a new message is received
export function onChatMessage(callback) {
    chatMessageCallback = callback;
}

// Register a callback function to be called when recent messages are received
export function onRecentMessages(callback) {
    recentMessagesCallback = callback;
}

// Get message history from memory
export function getChatHistory() {
    return [...messageHistory]; // Return a copy to prevent external modification
}

// Request initial messages when connecting
function requestInitialMessages() {
    getRecentMessages('global', DEFAULT_MESSAGE_LIMIT);
}

// Add a getter for other modules that might need the ID
export function getFirebaseUserId() {
    return firebaseDocId;
}

// Add fish or other items to the player's inventory
export function addToInventory(itemData) {
    if (!isConnected || !socket) return;

    console.log(`Adding item to inventory: ${itemData.item_name} (${itemData.item_type})`);

    // Send the inventory update to server
    socket.emit('add_to_inventory', {
        player_id: firebaseDocId,
        item_type: itemData.item_type,
        item_name: itemData.item_name,
        item_data: itemData.item_data
    });
}

// Get player inventory from the server using Socket.IO instead of fetch
export function getPlayerInventory(callback) {
    if (!isConnected || !socket || !firebaseDocId) {
        console.error("Cannot get inventory - not connected or no player ID");
        if (callback) callback(null);
        return false;
    }

    console.log(`DEBUG CLIENT: Sending get_inventory event with player_id: ${firebaseDocId}`);
    console.log(`DEBUG CLIENT: Socket connected: ${socket.connected}`);
    console.log(`DEBUG CLIENT: Socket ID: ${socket.id}`);

    socket.off('inventory_data');


    // Set up handler for inventory data response
    socket.on('inventory_data', (inventoryData) => {
        console.log('DEBUG CLIENT: Received inventory data:', inventoryData);
        if (callback) callback(inventoryData);
    });

    // Request inventory data via Socket.IO
    socket.emit('get_inventory', {
        player_id: firebaseDocId
    });

    return true;
}

// Helper function to check if player has a specific item
export function playerHasItem(inventoryData, itemType, itemName) {
    if (!inventoryData) return false;

    const itemCollection = inventoryData[itemType];
    if (!itemCollection || !Array.isArray(itemCollection)) return false;

    return itemCollection.some(item => item.name === itemName);
}
