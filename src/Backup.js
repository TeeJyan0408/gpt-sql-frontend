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
      const botMessage = {
        type: 'bot',
        sql: res.data.sql,
        results: res.data.results || [],
        view: 'both',
        chartType: 'bar'
      };
      setConversation(prev => [...prev, botMessage]);
    } catch (err) {
      const botMessage = {
        type: 'bot',
        error: err.response?.data?.error || 'Something went wrong',
      };
      setConversation(prev => [...prev, botMessage]);
    } finally {
      setLoading(false);
    }
  };

  const updateViewMode = (index, mode) => {
    setConversation(prev =>
      prev.map((msg, i) =>
        i === index ? { ...msg, view: mode } : msg
      )
    );
  };

  const updateChartType = (index, chartType) => {
    setConversation(prev =>
      prev.map((msg, i) =>
        i === index ? { ...msg, chartType } : msg
      )
    );
  };

  const exportToCSV = (rows, filename = 'results.csv') => {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const header = Object.keys(rows[0]).join(',');
    const data = rows.map(row => Object.values(row).join(',')).join('\n');
    const csvContent = `${header}\n${data}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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
              ) : (
                <div>
                  <strong>🤖 Result:</strong>

                  {/* View toggle */}
                  <div className="flex gap-2 my-2 text-sm">
                    <span className="font-medium">View:</span>
                    {["both", "table", "chart"].map(mode => (
                      <button
                        key={mode}
                        onClick={() => updateViewMode(i, mode)}
                        className={`px-2 py-1 rounded ${msg.view === mode ? "bg-blue-600 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>

                  {/* Chart type toggle */}
                  {msg.view !== 'table' && (
                    <div className="flex gap-2 mb-2 text-sm">
                      <span className="font-medium">Chart:</span>
                      {["bar", "line", "pie"].map(type => (
                        <button
                          key={type}
                          onClick={() => updateChartType(i, type)}
                          className={`px-2 py-1 rounded ${msg.chartType === type ? "bg-blue-500 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Table */}
                  {msg.view !== 'chart' && Array.isArray(msg.results) && msg.results.length > 0 && (
                    <>
                      <table className="w-full mt-2 table-auto border-collapse border border-black text-sm">
                        <thead>
                          <tr>
                            {Object.keys(msg.results[0] || {}).map((col, idx) => (
                              <th key={idx} className="border border-black px-2 py-1 bg-gray-100 text-left">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {msg.results.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {Object.values(row).map((val, colIndex) => (
                                <td key={colIndex} className="border border-black px-2 py-1">{val}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        onClick={() => exportToCSV(msg.results, `results_${i}.csv`)}
                        className="mt-2 text-sm text-blue-600 hover:underline"
                      >
                        📁 Export Table as CSV
                      </button>
                    </>
                  )}

                  {/* Fallback for empty results */}
                  {Array.isArray(msg.results) && msg.results.length === 0 && (
                    <p className="text-sm italic text-gray-500">No results found for this query.</p>
                  )}

                  {/* Charts */}
                  {msg.view !== 'table' && Array.isArray(msg.results) && msg.results.length > 0 && (() => {
                    const sample = msg.results[0];
                    const keys = Object.keys(sample || {});
                    const x = keys.find(k => typeof sample[k] === 'string' && !k.toLowerCase().includes('id'));
                    const numericKeys = keys.filter(k =>
                      typeof sample[k] === 'number' && !k.toLowerCase().includes('id')
                    );

                    return x && numericKeys.length > 0 ? (
                      numericKeys.map((yKey, chartIndex) => (
                        <div key={chartIndex} className="mt-6" id={`chart-${i}-${chartIndex}`}>
                          <h3 className="font-semibold text-sm mb-1">📊 {yKey} by {x}</h3>
                          <ResponsiveContainer width="100%" height={250}>
                            {msg.chartType === 'bar' ? (
                              <BarChart data={msg.results}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey={x} />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey={yKey} fill="#3b82f6" />
                              </BarChart>
                            ) : msg.chartType === 'line' ? (
                              <LineChart data={msg.results}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey={x} />
                                <YAxis />
                                <Tooltip />
                                <Line dataKey={yKey} stroke="#3b82f6" strokeWidth={2} />
                              </LineChart>
                            ) : (
                              <PieChart>
                                <Pie
                                  data={msg.results}
                                  dataKey={yKey}
                                  nameKey={x}
                                  cx="50%"
                                  cy="50%"
                                  outerRadius={80}
                                  label
                                >
                                  {msg.results.map((_, idx) => (
                                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip />
                              </PieChart>
                            )}
                          </ResponsiveContainer>

                          <button
                            onClick={() => downloadChartAsImage(`chart-${i}-${chartIndex}`, `chart_${i}_${yKey}.png`)}
                            className="mt-2 text-sm text-blue-600 hover:underline"
                          >
                            📸 Export Chart ({yKey})
                          </button>
                        </div>
                      ))
                    ) : null;
                  })()}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="text-center text-gray-600 italic">🤖 GPT is thinking...</div>
          )}
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
