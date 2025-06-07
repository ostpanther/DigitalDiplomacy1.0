from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import spacy
import json
import re
from pathlib import Path
from functools import lru_cache
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

class LetterSearchEngine:
    def __init__(self, data_path='../../docs/clean_results/jsons/10merged_json.json', 
                 model_path='tfidf_model.pkl'):
        
        try:
            self.nlp = spacy.load("ru_core_news_sm")
        except OSError:
            raise Exception("'ru_core_news_sm' не найдена")
        
        self.stop_words = list(self.nlp.Defaults.stop_words)
        
        
        self.data = self._load_data(data_path)
        
        
        self.vectorizer, self.tfidf_matrix = self._load_or_create_model(model_path)
    
    def _load_data(self, data_path):
        """Загрузка данных из JSON файла"""
        path = Path(data_path)
        if not path.exists():
            raise FileNotFoundError(f"Файл данных не найден: {path}")
            
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
        if not isinstance(data, list):
            raise ValueError("Данные должны быть списком писем")
            
        return data
    
    def _load_or_create_model(self, model_path):
        """Загрузка или создание TF-IDF модели"""
        path = Path(model_path)
        if path.exists():
            with open(path, 'rb') as f:
                model_data = pickle.load(f)
                return model_data['vectorizer'], model_data['matrix']
        else:
            return self._create_new_model()
    
    def _create_new_model(self):
        """Создание новой TF-IDF модели на основе всех полей"""
        vectorizer = TfidfVectorizer(
            stop_words=self.stop_words,
            ngram_range=(1, 3),
            max_features=10000
        )
        

        search_fields = [
            'Название', 'Дата', 'Аннотация', 
            'Текст', 'Источник', 'Отправитель', 'Получатель', 'Локация', 'Год'
        ]
        
        combined_texts = []
        for item in self.data:
            combined_text = ""
            for field in search_fields:
                if field in item:
                    value = item[field]
                    if isinstance(value, list):
                        combined_text += " " + " ".join(str(v) for v in value)
                    else:
                        combined_text += " " + str(value)
            combined_texts.append(self.preprocess_text(combined_text))
        
        tfidf_matrix = vectorizer.fit_transform(combined_texts)
        return vectorizer, tfidf_matrix
    
    def preprocess_text(self, text):
        """Предобработка текста"""
        if not isinstance(text, str):
            return ""
            
        text = text.replace('\r', '').replace('<', '').replace('>', '')
        text = re.sub(r'[^\w\s]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        
        if not hasattr(self, 'cache'):
            self.cache = {}
    
        if text in self.cache:
            return self.cache[text]
        
        doc = self.nlp(text.lower())
        tokens = [
            token.lemma_ 
            for token in doc 
            if not token.is_punct and not token.is_space
        ]
        result = ' '.join(tokens)
        self.cache[text] = result
        
        return result
    
    
    @lru_cache(maxsize=1000)
    def search(self, query, top_n=5):
        """Поиск писем по запросу"""
        if not query or not isinstance(query, str):
            return []
            
        query_processed = self.preprocess_text(query)
        try:
            query_vec = self.vectorizer.transform([query_processed])
        except ValueError:
            return [] 
            
        cos_sim = cosine_similarity(query_vec, self.tfidf_matrix)
        top_indices = cos_sim.argsort()[0][-top_n:][::-1]
        
        results = []
        for idx in top_indices:
            result = self.data[idx].copy()
            result['score'] = float(cos_sim[0, idx])
            result['excerpt'] = self.get_relevant_excerpt(result['Текст'], query)
            results.append(result)
        
        return sorted(results, key=lambda x: x['score'], reverse=True)
    
    def get_relevant_excerpt(self, text, query, window_size=150):
        """Получение релевантного фрагмента текста: первое вхождение"""
        if not text or not query:
            return ""

        query_doc = self.nlp(query.lower())
        query_lemmas = [token.lemma_ for token in query_doc 
                        if not token.is_punct and not token.is_space and not token.is_stop]
        
        if not query_lemmas:
            excerpt = text[:window_size]
            return (excerpt + '...') if len(text) > window_size else excerpt

        text_lower = text.lower()
        first_pos = None
        for lemma in query_lemmas:
            for token in self.nlp(text_lower):
                if token.lemma_ == lemma:
                    first_pos = token.idx
                    break
            if first_pos is not None:
                break

        if first_pos is None:
            excerpt = text[:window_size]
            return (excerpt + '...') if len(text) > window_size else excerpt

        # Вычисляем границы окна вокруг первой позиции
        start = max(0, first_pos - window_size // 2)
        end = start + window_size
        if end > len(text):
            end = len(text)
            start = max(0, end - window_size)

        # Выровнять начало и конец по границам слов
        if start > 0:
            sp = text.rfind(' ', 0, start)
            if sp != -1:
                start = sp + 1
        if end < len(text):
            ep = text.find(' ', end)
            if ep != -1:
                end = ep

        excerpt = text[start:end]
        if start > 0:
            excerpt = '...' + excerpt
        if end < len(text):
            excerpt = excerpt + '...'

        # Подсветка всех найденных форм леммы
        for lemma in set(query_lemmas):
            for token in set(self.nlp(text_lower)):
                if token.lemma_ == lemma and token.text.strip():
                    word = re.escape(token.text)
                    excerpt = re.sub(
                        rf"(\b{word}\b)",
                        r"<span class='highlight'>\1</span>",
                        excerpt,
                        flags=re.IGNORECASE
                    )
        return excerpt

    
    def save_model(self, output_path='tfidf_model.pkl'):
        """Сохранение модели на диск"""
        model_data = {
            'vectorizer': self.vectorizer,
            'matrix': self.tfidf_matrix
        }
        
        with open(output_path, 'wb') as f:
            pickle.dump(model_data, f)

def create_app():
    app = Flask(__name__)
    CORS(app)
    
    # Инициализируем движок ОДИН РАЗ при создании приложения
    search_engine = LetterSearchEngine()

    @app.route('/api/search')
    def handle_search():
        try:
            top_n = request.args.get('top_n', default=5, type=int)
            query = request.args.get('q', '')
            results = search_engine.search(query, top_n=top_n)
            
            threshold = 0.001
            filtered_results = [res for res in results if res['score'] > threshold]
            if not filtered_results:
                return jsonify({
                    "message": "Ничего не нашлось по данному запросу",
                    "details": "Попробуйте использовать другие ключевые слова"
                })
            return jsonify(filtered_results)
                    
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)


#python3 search_engine.py 