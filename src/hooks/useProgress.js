import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

export function useProgress(user) {
  const [mastered, setMastered] = useState(new Set());
  const [loaded, setLoaded] = useState(false);
  const [stats, setStats] = useState(null);

  // Load starred words and stats from Supabase when user logs in
  useEffect(() => {
    if (!user) {
      setMastered(new Set());
      setStats(null);
      setLoaded(true);
      return;
    }

    Promise.all([
      supabase
        .from("starred_words")
        .select("word_key")
        .eq("user_id", user.id),
      supabase
        .from("quiz_scores")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]).then(([starredRes, scoresRes]) => {
      if (!starredRes.error && starredRes.data) {
        setMastered(new Set(starredRes.data.map((row) => row.word_key)));
      }
      if (!scoresRes.error && scoresRes.data) {
        setStats(buildStats(scoresRes.data));
      }
      setLoaded(true);
    });
  }, [user]);

  const refreshStats = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("quiz_scores")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!error && data) {
      setStats(buildStats(data));
    }
  }, [user]);

  const toggleStar = useCallback(
    (wordKey) => {
      setMastered((prev) => {
        const next = new Set(prev);
        const wasStarred = next.has(wordKey);
        wasStarred ? next.delete(wordKey) : next.add(wordKey);

        if (user) {
          if (wasStarred) {
            supabase
              .from("starred_words")
              .delete()
              .eq("user_id", user.id)
              .eq("word_key", wordKey)
              .then(() => {});
          } else {
            supabase
              .from("starred_words")
              .insert({ user_id: user.id, word_key: wordKey })
              .then(() => {});
          }
        }

        return next;
      });
    },
    [user]
  );

  const saveQuizScore = useCallback(
    async (category, direction, hits, misses) => {
      if (!user) return;
      await supabase.from("quiz_scores").insert({
        user_id: user.id,
        category,
        direction,
        hits,
        misses,
      });
      refreshStats();
    },
    [user, refreshStats]
  );

  return { mastered, loaded, stats, toggleStar, saveQuizScore, refreshStats };
}

function buildStats(scores) {
  if (!scores.length) return { totalSessions: 0, categories: {}, recentScores: [], overallPct: 0, weakCategories: [], strongCategories: [] };

  const categories = {};
  let totalHits = 0, totalMisses = 0;

  for (const s of scores) {
    totalHits += s.hits;
    totalMisses += s.misses;

    if (!categories[s.category]) {
      categories[s.category] = { sessions: 0, hits: 0, misses: 0, lastPlayed: s.created_at };
    }
    categories[s.category].sessions += 1;
    categories[s.category].hits += s.hits;
    categories[s.category].misses += s.misses;
  }

  // Calculate percentages per category
  const catEntries = Object.entries(categories).map(([name, data]) => {
    const total = data.hits + data.misses;
    return { name, ...data, pct: total > 0 ? Math.round((data.hits / total) * 100) : 0 };
  });

  // Sort by percentage
  const sorted = [...catEntries].sort((a, b) => a.pct - b.pct);
  const weakCategories = sorted.filter(c => c.pct < 70).slice(0, 5);
  const strongCategories = [...sorted].reverse().filter(c => c.pct >= 70).slice(0, 5);

  const totalAll = totalHits + totalMisses;

  return {
    totalSessions: scores.length,
    totalHits,
    totalMisses,
    overallPct: totalAll > 0 ? Math.round((totalHits / totalAll) * 100) : 0,
    categories: Object.fromEntries(catEntries.map(c => [c.name, c])),
    recentScores: scores.slice(0, 10),
    weakCategories,
    strongCategories,
  };
}
