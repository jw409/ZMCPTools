// WebSocket connection management
class DashboardWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        this.lastUpdated = document.getElementById('last-updated');
        
        this.connect();
    }
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.setupEventHandlers();
        } catch (error) {
            console.error('WebSocket connection failed:', error);
            this.handleConnectionError();
        }
    }
    
    setupEventHandlers() {
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateConnectionStatus('connected', 'Connected');
        };
        
        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
                this.updateLastUpdated();
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.updateConnectionStatus('disconnected', 'Disconnected');
            this.scheduleReconnect();
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.handleConnectionError();
        };
    }
    
    handleMessage(data) {
        switch (data.type) {
            case 'status_update':
                this.handleStatusUpdate(data.data);
                break;
            case 'agent_spawned':
                this.handleAgentSpawned(data.data);
                break;
            case 'agent_terminated':
                this.handleAgentTerminated(data.data);
                break;
            case 'cleanup_completed':
                this.handleCleanupCompleted(data.data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }
    
    handleStatusUpdate(status) {
        // Update dashboard stats if on dashboard page
        if (window.location.pathname === '/') {
            this.updateDashboardStats(status);
        }
        
        // Update agent counts if on agents page
        if (window.location.pathname === '/agents') {
            this.updateAgentStats(status);
        }
    }
    
    handleAgentSpawned(data) {
        this.addActivityItem('🤖', `New ${data.agent_type || 'agent'} spawned`, 'Just now');
        
        if (window.showNotification) {
            window.showNotification('New agent spawned successfully', 'success');
        }
        
        // Refresh agents page if currently viewing it
        if (window.location.pathname === '/agents') {
            setTimeout(() => window.location.reload(), 1000);
        }
    }
    
    handleAgentTerminated(data) {
        this.addActivityItem('🛑', `Agent ${data.agent_id} terminated`, 'Just now');
        
        if (window.showNotification) {
            window.showNotification('Agent terminated', 'info');
        }
        
        // Refresh agents page if currently viewing it
        if (window.location.pathname === '/agents') {
            setTimeout(() => window.location.reload(), 1000);
        }
    }
    
    handleCleanupCompleted(data) {
        const operation = data.operation || 'cleanup';
        this.addActivityItem('🧹', `${operation} operation completed`, 'Just now');
        
        if (window.showNotification) {
            window.showNotification(`${operation} completed successfully`, 'success');
        }
        
        // Refresh cleanup page if currently viewing it
        if (window.location.pathname === '/cleanup') {
            setTimeout(() => window.location.reload(), 1000);
        }
    }
    
    updateDashboardStats(status) {
        // Update active agents count
        const activeAgentsEl = document.querySelector('.stat-value');
        if (activeAgentsEl && status.agents) {
            activeAgentsEl.textContent = status.agents.active || 0;
        }
        
        // Update storage information
        if (status.storage && status.storage.breakdown) {
            const storageItems = document.querySelectorAll('.storage-item');
            storageItems.forEach(item => {
                const label = item.querySelector('.storage-label').textContent.toLowerCase();
                const fill = item.querySelector('.storage-fill');
                const value = item.querySelector('.storage-value');
                
                if (label === 'database' && status.storage.breakdown.database_mb !== undefined) {
                    const percentage = (status.storage.breakdown.database_mb / (status.storage.total_size_mb || 1)) * 100;
                    fill.style.width = `${Math.round(percentage)}%`;
                    value.textContent = `${status.storage.breakdown.database_mb.toFixed(1)} MB`;
                }
            });
        }
    }
    
    updateAgentStats(status) {
        // This would update agent-specific UI elements
        console.log('Updating agent stats:', status);
    }
    
    addActivityItem(icon, text, time) {
        const activityList = document.getElementById('recent-activity');
        if (!activityList) return;
        
        const emptyState = activityList.querySelector('.empty-state');
        if (emptyState) {
            emptyState.remove();
        }
        
        const activityItem = document.createElement('div');
        activityItem.className = 'activity-item';
        activityItem.innerHTML = `
            <div class="activity-icon">${icon}</div>
            <div class="activity-content">
                <div class="activity-text">${text}</div>
                <div class="activity-time">${time}</div>
            </div>
        `;
        
        activityList.insertBefore(activityItem, activityList.firstChild);
        
        // Keep only the latest 10 items
        const items = activityList.querySelectorAll('.activity-item');
        if (items.length > 10) {
            items[items.length - 1].remove();
        }
    }
    
    updateConnectionStatus(status, text) {
        if (this.statusDot) {
            this.statusDot.className = `status-dot ${status}`;
        }
        if (this.statusText) {
            this.statusText.textContent = text;
        }
    }
    
    updateLastUpdated() {
        if (this.lastUpdated) {
            const now = new Date();
            this.lastUpdated.textContent = now.toLocaleTimeString();
        }
    }
    
    handleConnectionError() {
        this.updateConnectionStatus('disconnected', 'Connection Error');
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.updateConnectionStatus('disconnected', `Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connect();
            }, this.reconnectDelay * this.reconnectAttempts);
        } else {
            this.updateConnectionStatus('disconnected', 'Connection Failed');
        }
    }
    
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    
    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Initialize WebSocket when page loads
let dashboardWS = null;

document.addEventListener('DOMContentLoaded', () => {
    dashboardWS = new DashboardWebSocket();
});

// Close WebSocket when page unloads
window.addEventListener('beforeunload', () => {
    if (dashboardWS) {
        dashboardWS.close();
    }
});