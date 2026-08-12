import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[MomentumFlow UI error]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#0f1419', color: '#fff', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ marginTop: 0 }}>MomentumFlow couldn't load</h1>
          <p style={{ color: '#fca5a5' }}>{this.state.error.message || String(this.state.error)}</p>
          <p style={{ color: '#aaa' }}>Refresh once. If this remains, copy this message and send it to support.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
