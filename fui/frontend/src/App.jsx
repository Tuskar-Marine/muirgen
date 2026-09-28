import { useState, useEffect, useRef, useCallback } from 'react';
import useInterval from './useInterval';
import VesselSetup from './VesselSetup'; 
import UserSetup from './UserSetup';
import Login from './Login';
import { apiFetch } from './utils/api.js';
import Sidebar from './Sidebar';
import VesselEdit from './VesselEdit';
import VesselManagement from './VesselManagement';
import VesselRegistration from './VesselRegistration';
import UserEdit from './UserEdit';
import UserManagement from './UserManagement';
import EntityViewer from './EntityViewer.jsx';
import BatteryEdit from './BatteryEdit';
import BatteryManagement from './BatteryManagement.jsx';
import ConfigPanel from './ConfigPanel.jsx';
import HeadingTelemetry from './HeadingTelemetry';
import Skyview from './Skyview.jsx';
import TelemetryManagement from './TelemetryManagement.jsx';
import { formatCoordinate } from './utils/formatters';
import WindTelemetry from './WindTelemetry';
import Navigation from './Navigation.jsx';
import NavigationMaps from './NavigationMaps.jsx';
import WeatherTelemetry from './WeatherTelemetry.jsx';

const App = () => {
  // Remember where the user was in case the browser reloads. 
  const [viewStack, setViewStack] = useState([
    { id: 'VSM', context: null, list: [], index: 0, noteTarget: null }
  ]);
  const [allVessels, setAllVessels]       = useState([]);
  const [allUsers, setAllUsers]           = useState([]);
  const [allBatteries, setAllBatteries]   = useState([]);
  const [currentUser, setCurrentUser]     = useState(null);
  const [displayTime, setDisplayTime]     = useState('Acquiring Time Source...');
  const [dbData, setDbData]               = useState({ status: 'Connecting...', serverTime: '' });
  const hasRestoredSession                = useRef(false);
  // We need to make sure that isLoggingOut always reflects the current value, and isn't cached.
  const [isLoggingOut, setIsLoggingOut]   = useState(false);
  const isLoggingOutRef                   = useRef(false);
  const [isLoggedIn, setIsLoggedIn]       = useState(false);
  const [logoutMessage, setLogoutMessage] = useState('Carrier dropped, session closed');
  const [setupState, setSetupState]       = useState({userRequired: false, vesselRequired: false });
  const [vessel, setVessel]               = useState(null);
  // UID forced update tick to handle stuck animations.
  const [uiTick, setUiTick]               = useState(0);
  // Cartography Target Inspection
  const [activeMapFeature, setActiveMapFeature] = useState(null);
  
  // Live telemetry state
  const [liveTelemetry, setLiveTelemetry] = useState({
    position: null,
    motion: null,
    wind: null,
    weather: null,
    skyview: null
  });

  // Helper; Decaying accuracy glyphs
  const getAccuracyIndicator = (timestamp) => {
    // No timestamp is marked as dead.
    if (!timestamp) return { glyph: '🟕', className: 'telemetry-dead' }; 
 
    // How old is the last data?
    const ageSeconds = (Date.now() - timestamp) / 1000;

    // Pick the glyph based on the age of the last received GNSS fix.
    if (ageSeconds < 1) return { glyph: '🞊', className: 'telemetry-accurate' };
    if (ageSeconds < 2) return { glyph: '🞉', className: 'telemetry-fresh' };
    if (ageSeconds < 3) return { glyph: '🞈', className: 'telemetry-tolerable' };
    if (ageSeconds < 5) return { glyph: '🞇', className: 'telemetry-aging' };
    if (ageSeconds < 7) return { glyph: '🞆', className: 'telemetry-borderline' }
    if (ageSeconds < 9) return { glyph: '🞅', className: 'telemetry-limit' }
    return { glyph: '🟕', className: 'telemetry-dead' }; 
  };

  // Get the oldest timestamp from all  critical sensors.
  const getWorstTelemetryTimestamp = () => {
    // We need a satellite lock for the data to be considered good
    const positionIsLocked  = liveTelemetry.position?.latitude !== null && liveTelemetry.position?.longitude !== null;
    const positionTimestamp = positionIsLocked ? liveTelemetry.position?._timestamp : null;

    // TODO: More sources to be added
    const criticalTimestamps = [
      positionTimestamp
    ];

    // If any critical sensors are missing, the master state is 'dead' (0).
    if (criticalTimestamps.includes(undefined) || criticalTimestamps.includes(null)) {
      return 0;
    }

    // Return the oldest timestamp in the array
    return Math.min(...criticalTimestamps);
  };

  // Navigation helpers.
  const currentView = viewStack[viewStack.length - 1];
  const pushView    = useCallback((id, context = null, list = [], index = 0, noteTarget = null) => {
    setViewStack(prev => {
      const top = prev[prev.length - 1];
      if (top && top.id === id) {
        // Ignore, we're already showing this view
        return prev; 
      }
      return [...prev, { id, context, list, index, noteTarget }];
    });
  }, []);
  const popView = useCallback((optionalTargetNoteId = null) => {
    setViewStack(prev => {
      if (prev.length <= 1) return prev; // Never pop the last view (VSM)
      
      const newStack = [...prev];
      newStack.pop(); // Remove the top view
      
      // If a specific note target was passed back from the popped view, inject it into the new top view
      if (typeof optionalTargetNoteId === 'string') {
        newStack[newStack.length - 1] = { 
          ...newStack[newStack.length - 1], 
          noteTarget: optionalTargetNoteId 
        };
      } else {
        newStack[newStack.length - 1] = { 
          ...newStack[newStack.length - 1], 
          noteTarget: null 
        };
      }
      return newStack;
    });
  }, []);
  const resetToView = useCallback((id) => {
    if (id === 'VSM') {
      setViewStack([{ id: 'VSM', context: null, list: [], index: 0, noteTarget: null }]);
    } else {
      // Always anchor the breadcrumb tree to VSM
      setViewStack([
        { id: 'VSM', context: null, list: [], index: 0, noteTarget: null },
        { id, context: null, list: [], index: 0, noteTarget: null }
      ]);
    }
  }, []);

  const jumpToView = useCallback((targetIndex) => {
    setViewStack(prev => prev.slice(0, targetIndex + 1))
  }, []);
  const formatBreadcrumb = (id) => {
    // Short names to actual names mapping
    const map = {
      'VSM': 'VSM',                           // Vessel Status Monitor (root)
      'BATTERY_MANAGEMENT': 'Batteries',      // Adding, managing, logging, etc for batteries
      'CONFIG': 'Config',                     // 
      'MOTOR_MANAGEMENT': 'Motors',           // Adding, managing, logging, etc for motors
      'NAVIGATION': 'Navigation',             // Root navigation menu
      'NAVIGATION_MAPS': 'Cartography',       // The MapLibre engine
      'POWER_MANAGEMENT': 'Power',            // Adding, managing, logging, etc for power devices
      'SENSOR_MANAGEMENT': 'Sensors',         // Adding, managing, logging, etc for sensors
      'STATE': 'State',                       // Equipment status
      'TELEMETRY': 'Telemetry',               // Sensor data
      'TELEMETRY_HEADING': 'Heading Vectors', // Shows heading information (true and magnetic headings)
      'TELEMETRY_SKYVIEW': 'Skyview',         // The GNSS/GPS skyview
      'TELEMETRY_WEATHER': 'Weather Data',    // Shows weather station data and historical graphs
      'TELEMETRY_WIND': 'Wind Vectors',       // Shows wind information (direction and strength, true and apparent)
      'USER_MANAGEMENT': 'Operators',         // Adding, managing, logging, etc for users (not crew, though there may be some overlap)
      'VESSEL_EDIT': 'Edit',                  // ToDo - ^
      'VESSEL_MANAGEMENT': 'Vessels',         // Adding, managing, logging, etc for vessels
      'VESSEL_PROFILE': 'Profile',            // ToDo - How is this different from vessel management? Is this a sub page?
    };
    return map[id] || id;
  };

  // Local tick to update the displayed time each second.
  useInterval(() => {
    if (dbData.serverTime) {
      const now = new Date();
      // Format the date/time to YYY-MM-DD HH:MM:SS
      setDisplayTime(now.toLocaleString('sv-SE'));
    }
  }, 1000);
  
  // 
  const syncServerTime = async () => {
    try {
      const res = await fetch('/api/system/time');
      const data = await res.json();
      setDbData(data);
    } catch (err) {
      setDbData(prev => ({ ...prev, status: 'Time Source Offline. Error: ', err }));
    }
  };
  
  // Drift in browsers can be an issue, so we'll update the react time with the DB time every 30 seconds.
  useInterval(() => {
    syncServerTime();
  }, 30000);
  
  // If there's a last used view for the user (if they're logged in), load it.
  useEffect(() => {
    // Identify the operator, if they're logged in.
    const id = currentUser?.uuid || localStorage.getItem('muirgen_user_uuid');
    
    if (!id) {
      console.warn('Persistence: No user ID found.');
      return;
    }
    
    // Build the storage key from their ID. (Context is now stored inherently in the stack!)
    const stackKey = `muirgen_viewstack_${id}`;
    
    // Restore logic; Run only once.
    if (!hasRestoredSession.current) {
      const savedStack = localStorage.getItem(stackKey);
      
      if (savedStack) {
        try {
          const parsedStack = JSON.parse(savedStack);
          if (Array.isArray(parsedStack) && parsedStack.length > 0) {
            console.log(`Persistence: Restoring ViewStack for operator: [${id}]`, parsedStack);
            setViewStack(parsedStack);
          }
        } catch (err) {
          console.warn("Persistence: Failed to parse the saved view stack! The error was: ", err);
        }
        hasRestoredSession.current = true;
        return;
      }
      hasRestoredSession.current = true;
    }
    
    // If the user is logged in and changes the stack, save the whole array.
    if (isLoggedIn && !isLoggingOutRef.current) {
      console.log(`Persistence: Recording ViewStack to: [${stackKey}]`);
      localStorage.setItem(stackKey, JSON.stringify(viewStack));
    }
  }, [viewStack, currentUser, isLoggedIn]);

  // Watch for 401 or 403 errors indicating a bad token and triggering a logout.
  useEffect(() => {
    const handleAuthFailure = (event) => {
      // Set the specific error message from api.js
      setLogoutMessage(event.detail.message);
      
      // Trigger the same visual sequence as handleLogout
      setIsLoggingOut(true);
      isLoggingOutRef.current = true;
      
      setTimeout(() => {
        setIsLoggedIn(false);
        setVessel(null);
        setIsLoggingOut(false);
        isLoggingOutRef.current = false;
        // Reset the message for the next use.
        setLogoutMessage('Carrier dropped, session closed');
      }, 3000); // Longer detail for easier debugging in case of invalid ejection trigger.
    };
    
    window.addEventListener('muirgen-auth-failure', handleAuthFailure);
    return () => window.removeEventListener('muirgen-auth-failure', handleAuthFailure);
  }, []);
  
  // Fetch all vessels for management
  const fetchManagementData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/vessels/list-all');
      if (res.ok) {
        const data = await res.json();
        setAllVessels(data);
      }
    } catch (err) {
      console.error('Management fetch error:', err);
    }
  }, []);
  
  // Get the list of users.
  const fetchUserManagementData = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users/list');
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data);
      }
    } catch (err) {
      console.error('User management fetch error:', err);
    }
  }, []);

  // Get the list of batteries.
  const fetchBatteryData = useCallback(async () => {
    try {
      if (vessel?.uuid) {
        const res = await apiFetch(`/api/batteries/${vessel.uuid}/list`);
        if (res.ok) {
          const data = await res.json();
          setAllBatteries(data);
        }
      }
    } catch (err) {
      console.error('Battery fetch error:', err);
    }
  }, [vessel]);

  // Where are we?
  useEffect(() => {
    if (currentView?.id === 'VESSEL_MANAGEMENT' || 
        currentView?.id === 'VESSEL_EDIT'       || 
        currentView?.id === 'VESSEL_PROFILE'    ||
        currentView?.id === 'USER_EDIT'         ||
        currentView?.id === 'BATTERY_EDIT') {
      fetchManagementData();
    }
    if (currentView?.id === 'USER_MANAGEMENT' || currentView?.id === 'USER_EDIT' || currentView?.id === 'USER_PROFILE') {
      fetchUserManagementData();
    }
    if (currentView?.id === 'BATTERY_MANAGEMENT' || currentView?.id === 'BATTERY_EDIT' || currentView?.id === 'BATTERY_PROFILE') {
      fetchBatteryData();
    }
  }, [currentView?.id, fetchManagementData, fetchUserManagementData]);
  
  // Fetch initial last-known telemetry when the vessel loads
  useEffect(() => {
    if (!vessel || !vessel.uuid || !isLoggedIn) return;

    const fetchLastKnownTelemetry = async () => {
      try {
        const res = await apiFetch(`/api/vessels/${vessel.uuid}/telemetry/last-known`);
        if (res.ok) {
          const data = await res.json();
          setLiveTelemetry(prev => {
            const newState = { ...prev };
            // Only populate if we haven't already received fresh data via WebSocket
            if (data.position && !newState.position) {
              newState.position = {
                ...data.position,
                _location_timestamp: data.position._timestamp
              };
            }
            if (data.skyview && !newState.skyview) {
              newState.skyview = data.skyview;
            }
            return newState;
          });
        }
      } catch (err) {
        console.error('Failed to load last known telemetry:', err);
      }
    };
    
    fetchLastKnownTelemetry();
  }, [vessel, isLoggedIn]);

  // Refresh ViewContext with live data if we are editing.
  useEffect(() => {
    // We only refresh context if there's a valid ID and context to refresh!
    if (!currentView || !currentView.context) return;
    
    // Battery pages
    if (currentView?.id === 'BATTERY_EDIT' && allBatteries.length > 0) {
      const freshBattery = allBatteries.find(b => b.uuid === currentView.context.uuid);
      if (freshBattery && JSON.stringify(freshBattery) !== JSON.stringify(currentView.context)) {
        setViewStack(prev => {
          const newStack = [...prev];
          newStack[newStack.length - 1].context = freshBattery;
          return newStack;
        });
      }
    }

    // User pages
    if (currentView?.id === 'USER_EDIT' && allUsers.length > 0) {
      const freshUser = allUsers.find(u => u.uuid === currentView.context.uuid);
      if (freshUser && JSON.stringify(freshUser) !== JSON.stringify(currentView.context)) {
        setViewStack(prev => {
          const newStack = [...prev];
          newStack[newStack.length - 1].context = freshUser;
          return newStack;
        });
      }
    }

    // Vessel pages
    if (currentView?.id === 'VESSEL_EDIT' && allVessels.length > 0) {
      // Find the updated version of the vessel we're editing.
      const freshVessel = allVessels.find(v => v.uuid === currentView.context.uuid);

      // If found, and it's different (e.g. user count changed), update out context.
      if (freshVessel && JSON.stringify(freshVessel) !== JSON.stringify(currentView.context)) {
        // Replace the top of the stack with the fresh context
        setViewStack(prev => {
          const newStack = [...prev];
          newStack[newStack.length - 1].context = freshVessel;
          return newStack;
        });
      }
    }
    
    // Note: We don't need the other reload interceptors for VESSEL_PROFILE and USER_PROFILE anymore, 
    // because with the ViewStack, the full list context is persisted automatically in localStorage! 
  }, [allVessels, allUsers, currentView]);

  // Handle Logging the user out
  const handleLogout = async () => {
    // blurs the screen during the logout confirmation
    setIsLoggingOut(true);
    isLoggingOutRef.current = true;
    
    // Log the logout.
    const logPromise = apiFetch('/api/auth/logout', { method: 'POST' }).catch(err => {
      console.warn("Entering a log in audit_log appears to have failed:", err);
    });
    
    // Show the hang-up message for 2 seconds. 
    setTimeout(() => {
      // Clear the token locally
      localStorage.removeItem('muirgen_user_uuid');
      localStorage.removeItem('muirgen_token');
      setIsLoggedIn(false);
      setVessel(null);
      
      // Reset the VSM as the default display for the next user/session.
      resetToView('VSM');
      
      // unblur for the next session
      setIsLoggingOut(false);
      isLoggingOutRef.current = false;
    }, 2000);
    
    await logPromise;
  }

  const fetchData = useCallback(async () => {
    // If we're logging out, return, don't do anything else.
    if (isLoggingOutRef.current) return;
    
    const savedToken = localStorage.getItem('muirgen_token');
    
    // Backup check to see if we're logging out.
    if (!savedToken && isLoggingOut) return;
    
    // Check if we've got a saved token
    try {
      const [statusRes, syncRes] = await Promise.all([
        fetch(`/api/system/time`),
        apiFetch(`/api/auth/session-sync`)
      ]);
      
      const statusData = await statusRes.json();
      const syncData = await syncRes.json();

      // Map the identity from the JWT to state
      if (syncData.isLoggedIn && syncData.user) {
        console.log("Fetch: User object received: ", syncData.user);
        
        // Standardized ID lookup
        const id = syncData.user.uuid || localStorage.getItem('muirgen_user_uuid');
        
        if (id) {
          console.log(`Fetch: Standarzied ID to: [${id}]`);
          
          // Save this locally so the load effect can find it on browser reload.
          localStorage.setItem('muirgen_user_uuid', id);
          setCurrentUser(syncData.user);
          setIsLoggedIn(true);
        } else {
          console.error("Fetch: User found but no UUID property detected!");
        }
      } else {
        setCurrentUser(null);
      }
      
      setDbData(statusData);
      setSetupState(syncData);
      
      // If, for some reason, the setup is required but a stale token remains, delete it.
      if (syncData.userRequired || syncData.vesselRequired) {
        if (localStorage.getItem('muirgen_token')) {
          localStorage.removeItem('muirgen_token');
        }
        setIsLoggedIn(false);
      } else if (!isLoggingOutRef.current) {
        setIsLoggedIn(syncData.isLoggedIn);
      }
      
      // Get vessel data if the user is logged in.
      if (!syncData.userRequired && !syncData.vesselRequired && syncData.isLoggedIn) {
        const vesselRes = await apiFetch(`/api/vessels/current`);
        // prevents crashing on vesselRed.json() if the token was nuked.
        if (!vesselRes) { return; }
        const vesselData = await vesselRes.json();
        setVessel(vesselData);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, [isLoggingOut]);

  // Force React to re-evaluate the decaying accuracy glyphs each second.
  useInterval(() => {
    if (isLoggedIn && vessel) setUiTick(prev => prev + 1);
  }, 1000);

  // Websocket telemetry connection
  useEffect(() => {
    if (!isLoggedIn || !vessel) return;

    // Have the websocket retry failed connections every 3 seconds
    let websocket          = null;
    let reconnectTimeout   = null;
    let isComponentMounted = true; // Clears memory when the user browses away

    const connectWebSocket = () => {
      const protocol     = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const websocketUrl = `${protocol}//${window.location.host}`;

      websocket           = new WebSocket(websocketUrl);
      websocket.onopen    = () => console.log("WebSocket comms established successfully.");
      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.topic && data.payload && data.payload.vessel_uuid === vessel.uuid) {
            const topicParts = data.topic.split('/');
            const subject    = topicParts[topicParts.length - 1];

            setLiveTelemetry(prev => {
              const currentSubject = prev[subject] || {};
              const newPayload     = { ...data.payload };

              // Discard NULLs so fragmented PGNs don't overwrite previous data.
              Object.keys(newPayload).forEach(key => {
                if (newPayload[key] === null) {
                  delete newPayload[key];
                }
              });

              const merged = {
                ...currentSubject, 
                ...newPayload, 
                _timestamp: Date.now()
              };

              // If this payload included coordinates, track exactly when we got them
              if (newPayload.latitude !== undefined) {
                merged._location_timestamp = Date.now();
              }

              return {
                ...prev,
                [subject]: merged
              };
            });
          }
        } catch (err) {
          console.error('Error parsing WebSocket message. Error:', err);
        }
      };

      websocket.onclose = () => {
        console.log('WebSocket comms closed. Attempting reconnect in 3s...');
        if (isComponentMounted) {
          // Schedule a reconnection attempt
          reconnectTimeout = setTimeout(connectWebSocket, 3000);
        }
      };

      websocket.onerror = (err) => {
        console.error('WebSocket error:', err);
        websocket.close(); // Force the onclose handler to fire so it triggers the reconnect loop
      };
    };

    // Kick off the initial connection
    connectWebSocket();

    return () => {
      isComponentMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (websocket) websocket.close(); // Cleanup on unmount

    };
  }, [isLoggedIn, vessel]);

  // Initial load
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="App">
      <div className="crt-overlay" />
      
      {/* Background Layer; sky-ground walking grid background. Blurred during log-out */}
      <div className={`grid-container ${isLoggingOut ? 'blur-active' : ''}`}>
        <div className="wireframe-grid sky" />
        <div className="wireframe-grid ground" />
      </div>
      
      {/* The main view port */}
      <main className="main-layout">

        {/* Navigation Sidebar */}
        {isLoggedIn && !isLoggingOut && (
          <Sidebar 
            activeView={currentView?.id} setActiveView={resetToView} onLogout={handleLogout} 
            dataAlarm={getAccuracyIndicator(getWorstTelemetryTimestamp())}
            activeMapFeature={activeMapFeature}
            setActiveMapFeature={setActiveMapFeature}
          />
        )}
        
        {/* Dynamic background Viewport */}
        <div className={`content-viewport ${isLoggingOut ? 'blur-active' : ''}`}>
          
          {/* Top Telemetry Header (Navigation Data) */}
          <div className="telemetry-header">
            {/* WIND (True / Apparent) */}
            <div className="telemetry-header-block">
              <span className="telemetry-header-text">Wind ⫽ (T/A) [</span>
              {liveTelemetry.wind?._timestamp && (Date.now() - liveTelemetry.wind._timestamp < 10000) ? (
                <>
                  <span className={(liveTelemetry.wind.true_direction ?? liveTelemetry.wind.ground_direction) != null ? "" : "telemetry-dead"}>
                    {(liveTelemetry.wind.true_direction ?? liveTelemetry.wind.ground_direction) != null ? `${(liveTelemetry.wind.true_direction ?? liveTelemetry.wind.ground_direction).toFixed(0).padStart(3, '0')}° ` : '---° '}
                    {(liveTelemetry.wind.true_speed ?? liveTelemetry.wind.ground_speed) != null ? ((liveTelemetry.wind.true_speed ?? liveTelemetry.wind.ground_speed) * 1.94384).toFixed(1) : '--.-'}
                  </span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className={liveTelemetry.wind.apparent_direction != null ? "" : "telemetry-dead"}>
                    {liveTelemetry.wind.apparent_direction != null ? `${liveTelemetry.wind.apparent_direction.toFixed(0).padStart(3, '0')}° ` : '---° '}
                    {liveTelemetry.wind.apparent_speed != null ? (liveTelemetry.wind.apparent_speed * 1.94384).toFixed(1) : '--.-'}
                  </span>
                </>
              ) : (
                <>
                  <span className="telemetry-dead">---° --.-</span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className="telemetry-dead">---° --.-</span>
                </>
              )}
              <span className="telemetry-header-text">] kts</span>
            </div>

            {/* HEADING (True / Magnetic) */}
            <div className="telemetry-header-block">
              <span className="telemetry-header-text">Heading ⫽ (T/M) [</span>
              {liveTelemetry.motion?._timestamp && (Date.now() - liveTelemetry.motion._timestamp < 10000) ? (
                <>
                  <span className={liveTelemetry.motion.heading_magnetic != null && liveTelemetry.motion.magnetic_variation != null ? "" : "telemetry-dead"}>
                    {liveTelemetry.motion.heading_magnetic != null && liveTelemetry.motion.magnetic_variation != null 
                      ? `${((liveTelemetry.motion.heading_magnetic + liveTelemetry.motion.magnetic_variation + 360.0) % 360.0).toFixed(0).padStart(3, '0')}°` 
                      : '---°'}
                  </span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className={liveTelemetry.motion.heading_magnetic != null ? "" : "telemetry-dead"}>
                    {liveTelemetry.motion.heading_magnetic != null ? `${liveTelemetry.motion.heading_magnetic.toFixed(0).padStart(3, '0')}°` : '---°'}
                  </span>
                </>
              ) : (
                <>
                  <span className="telemetry-dead">---°</span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className="telemetry-dead">---°</span>
                </>
              )}
              <span className="telemetry-header-text">]</span>
            </div>

            {/* SPEED (Ground / Water) */}
            <div className="telemetry-header-block">
              <span className="telemetry-header-text">Speed ⫽ (G/W) [</span>
              {liveTelemetry.motion?._timestamp && (Date.now() - liveTelemetry.motion._timestamp < 10000) ? (
                <>
                  <span className={liveTelemetry.motion.speed_over_ground != null ? "" : "telemetry-dead"}>
                    {liveTelemetry.motion.speed_over_ground != null ? (liveTelemetry.motion.speed_over_ground * 1.94384).toFixed(1) : '--.-'}
                  </span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className={liveTelemetry.motion.speed_through_water != null ? "" : "telemetry-dead"}>
                    {liveTelemetry.motion.speed_through_water != null ? (liveTelemetry.motion.speed_through_water * 1.94384).toFixed(1) : '--.-'}
                  </span>
                </>
              ) : (
                <>
                  <span className="telemetry-dead">--.-</span>
                  <span className="telemetry-data-divider">┆</span>
                  <span className="telemetry-dead">--.-</span>
                </>
              )}
              <span className="telemetry-header-text">] kts</span>
            </div>

            {/* DEPTH (Keel) */}
            <div className="telemetry-header-block">
              <span className="telemetry-header-text">Depth ⫽ K: [</span>
              {liveTelemetry.depth?._timestamp && (Date.now() - liveTelemetry.depth._timestamp < 10000) ? (
                <span className={liveTelemetry.depth.depth != null ? "" : "telemetry-dead"}>
                  {liveTelemetry.depth.depth != null ? liveTelemetry.depth.depth.toFixed(1) : '--.-'}
                </span>
              ) : (
                <span className="telemetry-dead">--.-</span>
              )}
              <span className="telemetry-header-text">] m</span>
            </div>
          </div>

          {/* Breadcrumn Navigation Trail */}
          <div className="breadcrumb-header">
            {viewStack.map((view, index) => (
              <span key={index}>
                <span 
                  className={`breadcrumb-item ${index === viewStack.length - 1 ? 'active' : 'clickable'}`} 
                  onClick={() => { if (index < viewStack.length - 1) jumpToView(index); }}
                >
                  {formatBreadcrumb(view.id)}
                </span>
                {index < viewStack.length - 1 && <span className="breadcrumb-separator"> ⫽ </span>}
              </span>
            ))}
          </div>

          {/* View Center Container */}
          <div className="view-center-container">
            
            {/* The main VSM box */}
            {setupState.vesselRequired ? (
              <>
                <h3 className="step-title">⏃ Initial Vessel Registration</h3>
                <VesselSetup onComplete={fetchData} />
              </>
            ) : setupState.userRequired ? (
              <>
                <h3 className="step-title">⏿ System Operator Registration</h3>
                <UserSetup onComplete={fetchData} />
              </>
            ) : !isLoggedIn ? (
              <>
                <h3 className="step-title">Security: Enter Credentials</h3>
                <Login onLoginSuccess={() => { setIsLoggedIn(true); fetchData();}} />
              </>
            ) : (
              <>
                {/* The main / initial page. For now, it's a simple data box */}
                {currentView?.id === 'VSM' && vessel && (
                  <>
                    <h3 className="step-title">◫ Vessel Status Monitor ⫽ {vessel.name || 'Loading...'}</h3>
                    <p>Flag Nation: {vessel.flag_nation || 'Loading...'}</p>
                    <p>Home Port: {vessel.port_of_registry || 'Loading...'}</p>
                    <p>Build Details: {vessel.build_details || 'Loading...'}</p>
                    <p>Official Number: {vessel.official_number || 'Loading...'}</p>
                    <p>Hull ID Number: {vessel.hull_id_number || 'Loading...'}</p>
                    <p>Database UUID: {vessel.uuid || 'Loading...'}</p>
                  </>
                )}
                
                {/* Systems Configuration Root Map */}
                {currentView?.id === 'CONFIG' && (
                  <ConfigPanel pushView={pushView} />
                )}

                {/* Telemetry Root Map */}
                {currentView?.id === 'TELEMETRY' && (
                  <TelemetryManagement pushView={pushView} />
                )}

                {/* Skyview Diagnostics Panel */}
                {currentView?.id === 'TELEMETRY_SKYVIEW' && (
                  <Skyview liveTelemetry={liveTelemetry} />
                )}
                
                {/* Wind telemetry panel */}
                {currentView?.id === 'TELEMETRY_WIND' && (
                  <WindTelemetry liveTelemetry={liveTelemetry} />
                )}

                {/* Heading (compass) telemetry panel */}
                {currentView?.id === 'TELEMETRY_HEADING' && (
                  <HeadingTelemetry liveTelemetry={liveTelemetry} />
                )}

                {/* Weather telemetry panel */}
                {currentView?.id === 'TELEMETRY_WEATHER' && (
                  <WeatherTelemetry liveTelemetry={liveTelemetry} vessel={vessel} />
                )}

                {/* Navigation Root Menu */}
                {currentView?.id === 'NAVIGATION' && (
                  <Navigation pushView={pushView} />
                )}

                {/* Navigation Cartography Canvas */}
                {currentView?.id === 'NAVIGATION_MAPS' && (
                  <NavigationMaps 
                    liveTelemetry={liveTelemetry} 
                    setActiveMapFeature={setActiveMapFeature}
                  />
                )}

                {/* The vessel management */}
                {currentView?.id === 'VESSEL_MANAGEMENT' && (
                  <VesselManagement
                    vessels={allVessels}
                    onView={(vList, vIndex) => {
                      pushView('VESSEL_PROFILE', vList[vIndex], vList, vIndex);
                    }}
                    onModify={(v) => {
                      localStorage.removeItem('vessel_edit_active_tab');
                      pushView('VESSEL_EDIT', v);
                    }}
                    onRegister={() => {
                      localStorage.removeItem('vessel_edit_active_tab');
                      pushView('VESSEL_EDIT', null);
                    }}
                  />
                )}
                
                {currentView?.id === 'VESSEL_PROFILE' && currentView.list?.length > 0 && (
                  <EntityViewer
                    entities={currentView.list}
                    initialIndex={currentView.index}
                    referenceTable="vessels"
                    jumpToNoteId={currentView.noteTarget} 
                    onOptics={(entity) => {
                      pushView('VESSEL_EDIT', entity, [], 0, 'optics');
                    }}
                    onEdit={(entity) => {
                      localStorage.removeItem('vessel_edit_active_tab');
                      pushView('VESSEL_EDIT', entity);
                    }}
                    onAddNote={(entity) => {
                      pushView('VESSEL_EDIT', entity, [], 0, 'new');
                    }}
                    onClose={() => popView()}
                    onNoteSelect={(noteId) => {
                      pushView('VESSEL_EDIT', currentView.list[currentView.index], [], 0, noteId);
                    }}
                  >
                    {/* Merchant Marine Readouts for Vessels */}
                    {(entity) => (
                      <>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Vessel Name</div>
                          <div className="telemetry-value">{entity.name}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Official Number</div>
                          <div className="telemetry-value">{entity.official_number || 'Unknown'}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Hull ID</div>
                          <div className="telemetry-value">{entity.hull_id_number || 'Unknown'}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Flag State</div>
                          <div className="telemetry-value">{entity.flag_nation || 'Unknown'}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Status</div>
                          <div className={`telemetry-value ${entity.is_active ? 'entity-status-active' : 'entity-status-inactive'}`}>
                            {entity.is_active ? 'Active' : 'Inactive'}
                          </div>
                        </div>
                      </>
                    )}
                  </EntityViewer>
                )}

                {/* The vessel edit form (for managing existing vessels) */}
                {currentView?.id === 'VESSEL_EDIT' && currentView.context && (
                  <VesselEdit 
                    vessel={currentView.context}
                    activeCount={allVessels.filter(v => v.is_active).length}
                    jumpToNoteId={currentView.noteTarget} 
                    onComplete={() => {
                      fetchManagementData();  // refresh the index
                      popView();
                    }}
                    onCancel={(cancelNoteId) => {
                      popView(typeof cancelNoteId === 'string' ? cancelNoteId : null);
                    }}
                  />
                )}
                
                {/* The new vessel registration form (adding addition vessels) */}
                {currentView?.id === 'VESSEL_REGISTRATION' && (
                  <VesselRegistration 
                    onComplete={() => {
                      // refresh the index
                      fetchManagementData(); 
                      popView();
                    }}
                  />
                )}

                {/* The Operator views */}
                {currentView?.id === 'USER_MANAGEMENT' && (
                  <UserManagement
                    users={allUsers}
                    onView={(uList, uIndex) => {
                      pushView('USER_PROFILE', uList[uIndex], uList, uIndex);
                    }}
                    onModify={(u) => {
                      localStorage.removeItem('user_edit_active_tab');
                      pushView('USER_EDIT', u);
                    }}
                    onRegister={() => {
                      localStorage.removeItem('user_edit_active_tab');
                      pushView('USER_EDIT', null);
                    }}
                  />
                )}
                
                {currentView?.id === 'USER_PROFILE' && currentView.list?.length > 0 && (
                  <EntityViewer
                    entities={currentView.list}
                    initialIndex={currentView.index}
                    referenceTable="users"
                    jumpToNoteId={currentView.noteTarget} 
                    onOptics={(entity) => {
                      pushView('USER_EDIT', entity, [], 0, 'optics');
                    }}
                    onEdit={(entity) => {
                      localStorage.removeItem('user_edit_active_tab');
                      pushView('USER_EDIT', entity);
                    }}
                    onAddNote={(entity) => {
                      pushView('USER_EDIT', entity, [], 0, 'new');
                    }}
                    onClose={() => popView()}
                    onNoteSelect={(noteId) => {
                      pushView('USER_EDIT', currentView.list[currentView.index], [], 0, noteId);
                    }}
                  >
                    {/* These are the custom child specs for an Operator! */}
                    {(entity) => (
                      <>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Name</div>
                          <div className="telemetry-value">{entity.name}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Access</div>
                          <div className="telemetry-value">{entity.is_admin ? '◈ SysOp' : '◇ Operator'}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Status</div>
                          <div className="telemetry-value" style={{ color: entity.is_active ? 'var(--neon-red)' : 'var(--soft-red)' }}>
                            {entity.is_active ? 'Active' : 'Deactivated'}
                          </div>
                        </div>
                      </>
                    )}
                  </EntityViewer>
                )}

                {currentView?.id === 'USER_EDIT' && (
                  <UserEdit 
                    user={currentView.context}
                    activeCount={allUsers.filter(u => u.is_active).length}
                    activeVessel={vessel}
                    vessels={allVessels}
                    jumpToNoteId={currentView.noteTarget}
                    onSaveSuccess={(newUuid) => {
                      fetchUserManagementData();
                      if (!currentView.context) {
                        // If this was a creation, transition to edit mode instantly
                        setViewStack(prev => {
                          const newStack = [...prev];
                          newStack[newStack.length - 1].context = { uuid: newUuid };
                          return newStack;
                        });
                      }
                    }}
                    onComplete={() => {
                      // Refresh list to reflect updates
                      fetchUserManagementData(); 
                      popView();
                    }}
                    onCancel={(cancelNoteId) => {
                      popView(typeof cancelNoteId === 'string' ? cancelNoteId : null);
                    }}
                  />
                )}

                {/* The battery views */}
                {currentView?.id === 'BATTERY_MANAGEMENT' && (
                  <BatteryManagement 
                    batteries={allBatteries}
                    onView={(batteryList, batteryIndex) => {
                      pushView('BATTERY_PROFILE', batteryList[batteryIndex], batteryList, batteryIndex);
                    }}
                    onModify={(battery) => {
                      localStorage.removeItem('battery_edit_active_tab');
                      pushView('BATTERY_EDIT', battery);
                    }}
                    onRegister={() => {
                      localStorage.removeItem('battery_edit_active_tab')
                      pushView('BATTERY_EDIT', null);
                    }}
                  />
                )}

                {currentView?.id === 'BATTERY_PROFILE' && currentView.list?.length > 0 && (
                  <EntityViewer
                    entities={currentView.list}
                    initialIndex={currentView.index}
                    referenceTable="batteries"
                    jumpToNoteId={currentView.noteTarget} 
                    onOptics={(entity) => {
                      pushView('BATTERY_EDIT', entity, [], 0, 'optics');
                    }}
                    onEdit={(entity) => {
                      localStorage.removeItem('battery_edit_active_tab');
                      pushView('BATTERY_EDIT', entity);
                    }}
                    onAddNote={(entity) => {
                      pushView('BATTERY_EDIT', entity, [], 0, 'new');
                    }}
                    onClose={() => popView()}
                    onNoteSelect={(noteId) => {
                      pushView('BATTERY_EDIT', currentView.list[currentView.index], [], 0, noteId);
                    }}
                  >
                    {(entity) => (
                      <>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Name</div>
                          <div className="telemetry-value">{entity.name}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Capacity</div>
                          <div className="telemetry-value">{entity.nominal_voltage} VDC, {entity.capacity} Ah</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Chemistry</div>
                          <div className="telemetry-value">{entity.chemistry}</div>
                        </div>
                        <div className="telemetry-block">
                          <div className="telemetry-label">Status</div>
                          <div className={`telemetry-value ${entity.is_active ? 'entity-status-active' : 'entity-status-inactive'}`}>
                            {entity.is_active ? 'Active' : 'Inactive'}
                          </div>
                        </div>
                      </>
                    )}
                  </EntityViewer>
                )}

                {currentView?.id === 'BATTERY_EDIT' && (
                  <BatteryEdit 
                    battery={currentView.context}
                    activeVessel={vessel}
                    vessels={allVessels}
                    jumpToNoteId={currentView.noteTarget}
                    onSaveSuccess={(newUuid) => {
                      fetchBatteryData();
                      if (!currentView.context) {
                        setViewStack(prev => {
                          const newStack = [...prev];
                          newStack[newStack.length - 1].context = { uuid: newUuid };
                          return newStack;
                        });
                      }
                    }}
                    onComplete={() => {
                      fetchBatteryData(); 
                      popView();
                    }}
                    onCancel={(cancelNoteId) => {
                      popView(typeof cancelNoteId === 'string' ? cancelNoteId : null);
                    }}
                  />
                  )}
              </>
            )}
          </div>
          
          {/* Telemetry footer */}
          <div className="telemetry-footer">
            <div className="telemetry-item">
              <span className="telemetry-header-text">System Time ⫽</span> <span className="telemetry-accurate">{displayTime}</span>
            </div>
            <div className="telemetry-item">
              <span className="telemetry-header-text">ETA ⫽</span>
                <span className="telemetry-off">no active waypoint</span>
            </div>
            {/* GPS lat/lon. */}
            <div className="telemetry-item telemetry-clickable" onClick={() => {
              setViewStack([
                { id: 'VSM', context: null, list: [], index: 0, noteTarget: null },
                { id: 'TELEMETRY', context: null, list: [], index: 0, noteTarget: null },
                { id: 'TELEMETRY_SKYVIEW', context: null, list: [], index: 0, noteTarget: null }
              ]);
            }}>
              <span className="telemetry-header-text">Position ⫽ </span>
              {liveTelemetry.position?._timestamp && (Date.now() - liveTelemetry.position._timestamp < 10000) ? (
                (liveTelemetry.position.latitude != null && liveTelemetry.position.longitude != null && getAccuracyIndicator(liveTelemetry.position._location_timestamp).className !== 'telemetry-dead') ? (
                  <span>
                    {`${formatCoordinate(liveTelemetry.position.latitude, true)}, ${formatCoordinate(liveTelemetry.position.longitude, false)}, `}
                  </span>
                ) : (
                  <span className="telemetry-dead">⍙ Acquiring Satellites ⍙</span>
                )
              ) : (
                <span className="telemetry-dead">---° --.---', ---° --.---', </span>
              )}
              {/* Horizontal Dilution of Precision (HDOP); Under 2 is acceptable accuracy. Under 0.8 is ideal. */}
                {liveTelemetry?.skyview && (
                <span className="telemetry-right-pad">
                  HDOP: [{getAccuracyIndicator(liveTelemetry.position?._location_timestamp).className !== 'telemetry-dead' && liveTelemetry.skyview.horizontal_dop != null ? liveTelemetry.skyview.horizontal_dop.toFixed(2) : '--'}]
                </span>
              )}
            </div>
          </div>
        </div>
    
        {/* Logout Overlay; Success message must stay inside the viewport to be visible during logout. */}
        {isLoggingOut && (
          <div className="status-display success logout-overlay">
            {logoutMessage}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
