
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer
} from 'recharts';
import html2canvas from 'html2canvas';

const COLORS = ['#3b82f6', '#f97316', '#10b981', '#ef4444', '#6366f1', '#eab308'];

export default function App() {
  const [query, setQuery] = useState('');
  const [conversation, setConversation] = useState([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [recentQueries, setRecentQueries] = useState(() => {
    const saved = localStorage.getItem("recentQueries");
    return saved ? JSON.parse(saved) : [];
  });

  const messagesEndRef = useRef(null);

  useEffect(() => {
    axios.get('http://localhost:5000/schema_suggestions')
      .then(res => setSuggestions(res.data))
      .catch(() => setSuggestions([]));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    const userMessage = { type: 'user', content: query };
    setConversation(prev => [...prev, userMessage]);
    setLoading(true);
    setQuery('');

    const updatedRecent = [query, ...recentQueries.filter(q => q !== query)].slice(0, 5);
    setRecentQueries(updatedRecent);
    localStorage.setItem("recentQueries", JSON.stringify(updatedRecent));

    try {
      const res = await axios.post('http://localhost:5000/query', { query });

      if (res.data.action) {
        const action = JSON.parse(res.data.action);
        const targetIndex = [...conversation].reverse().findIndex(m => m.type === "bot" && m.results);
        if (targetIndex !== -1) {
          const reverseIndex = conversation.length - 1 - targetIndex;
          setConversation(prev =>
            prev.map((msg, i) => {
              if (i === reverseIndex) {
                return {
                  ...msg,
                  chartType: action.chartType || msg.chartType,
                  chartColor: action.color || msg.chartColor,
                };
              }
              return msg;
            })
          );
        }
        return;
      }

      if (res.data.reply) {
        setConversation(prev => [...prev, { type: 'bot', reply: res.data.reply }]);
        return;
      }

      setConversation(prev => [...prev, {
        type: 'bot',
        sql: res.data.sql,
        results: res.data.results || [],
        view: 'both',
        chartType: 'bar'
      }]);
    } catch (err) {
      setConversation(prev => [...prev, {
        type: 'bot',
        error: err.response?.data?.error || 'Something went wrong'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const updateViewMode = (index, mode) => {
    setConversation(prev =>
      prev.map((msg, i) => i === index ? { ...msg, view: mode } : msg)
    );
  };

  const updateChartType = (index, chartType) => {
    setConversation(prev =>
      prev.map((msg, i) => i === index ? { ...msg, chartType } : msg)
    );
  };

  const exportToCSV = (rows, filename = 'results.csv') => {
    const header = Object.keys(rows[0]).join(',');
    const data = rows.map(row => Object.values(row).join(',')).join('\n');
    const blob = new Blob([`${header}\n${data}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  };

  const downloadChartAsImage = (containerId, filename = 'chart.png') => {
    const chartEl = document.getElementById(containerId);
    if (!chartEl) return;
    html2canvas(chartEl).then(canvas => {
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL();
      link.click();
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6 flex flex-col items-center">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-6 space-y-4 relative">
        <h1 className="text-2xl font-bold text-center">🧠 GPT-to-SQL Assistant</h1>

        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {conversation.map((msg, i) => (
            <div key={i} className="p-4 rounded-xl border border-gray-300 bg-white">
              {msg.type === 'user' ? (
                <div><strong>🧑 You:</strong> {msg.content}</div>
              ) : msg.error ? (
                <div className="text-red-500"><strong>⚠️ Error:</strong> {msg.error}</div>
              ) : msg.reply ? (
                <div><strong>🤖</strong> {msg.reply}</div>
              ) : (
                <div>
                  <strong>🤖 Result:</strong>
                  {/* Add toggles and conditional rendering here */}
                  {/* Table and chart rendering omitted for brevity */}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="text-center text-gray-600 italic">🤖 GPT is thinking...</div>}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col items-stretch pt-4 w-full relative">
          <input
            className="flex-grow border border-gray-300 rounded-xl px-4 py-2"
            type="text"
            placeholder="Ask a business question..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 mt-2 rounded-xl hover:bg-blue-700"
          >
            {loading ? '...' : 'Ask'}
          </button>
        </form>
      </div>
    </div>
  );
}
