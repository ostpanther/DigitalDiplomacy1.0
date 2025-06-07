import requests
from pathlib import Path
import datetime
import re
from typing import List, Dict, Any

class SpellChecker:
    def __init__(self, config: Dict[str, Any] = None):
        self.config = {
            'api_url': "https://speller.yandex.net/services/spellservice.json/checkText",
            'max_retries': 3,
            'suggestions_limit': 5,
            'context_window': 50,
            'log_format': 'markdown',
            ** (config or {})
        }

    def check_spelling(self, text: str, lang: str = 'ru') -> List[Dict]:
        """Проверка орфографии с повторами при ошибках сети"""
        for attempt in range(self.config['max_retries']):
            try:
                response = requests.get(
                    self.config['api_url'],
                    params={'text': text, 'lang': lang},
                    timeout=5
                )
                if response.status_code == 200:
                    return response.json()
                return []
            except requests.exceptions.RequestException as e:
                if attempt == self.config['max_retries'] - 1:
                    print(f"⚠️ Ошибка проверки: {e}")
                    return []

    def apply_correction(self, text: str, error: Dict, correction: str) -> str:
        """Умное применение правок с сохранением регистра и форматирования"""
        start = error['pos']
        end = start + error['len']
        original = text[start:end]
        
        if original != original.lower():
            if original.istitle():
                correction = correction.title()
            elif original.isupper():
                correction = correction.upper()
            elif '-' in original:  
                parts = correction.split('-')
                correction = '-'.join([p.capitalize() for p in parts])
        
        return text[:start] + correction + text[end:]

    def process_block(self, block: str, block_num: int, log_path: Path) -> str:
        """Обработка одного блока текста с повторной проверкой и логированием"""
        corrected = block
        while True:
            errors = self.check_spelling(corrected)
            if not errors:
                break  

            changes_made = False

            for error in sorted(errors, key=lambda x: -x['pos']):
                error_text = corrected[error['pos']:error['pos']+error['len']]
                suggestions = error.get('s', [])[:self.config['suggestions_limit']]

                print(f"\n{'═'*50}")
                print(f"🔍 Блок #{block_num}")
                print(f"❌ Ошибка: {error_text}")
                self._print_context(corrected, error['pos'], error['len'])
                
                choice = self._get_user_choice(suggestions)
                if choice == 'skip':
                    continue

                correction = self._handle_choice(choice, suggestions)
                # Применяем исправление
                corrected = self.apply_correction(corrected, error, correction)
                
                # Логирование исправления
                self.log_correction(
                    log_path,
                    block_num,
                    error_text,
                    suggestions,
                    correction,
                    choice
                )
                
                changes_made = True


            if not changes_made:
                break

        return corrected


    def _print_context(self, text: str, pos: int, length: int):
        """Печать контекста ошибки с подсветкой"""
        start = max(0, pos - self.config['context_window'])
        end = min(len(text), pos + length + self.config['context_window'])
        context = text[start:end]
        context = context.replace('\n', ' ')
        error_part = text[pos:pos+length]
        
        highlighted = re.sub(
            re.escape(error_part), 
            f'\033[91m{error_part}\033[0m', 
            context, 
            count=1
        )
        print(f"📄 Контекст: ...{highlighted}...")

    def _get_user_choice(self, suggestions: List[str]) -> str:
        """Интерактивный выбор с валидацией"""
        print("\nВарианты исправления:")
        for i, s in enumerate(suggestions, 1):
            print(f"  {i}. {s}")
        print("  s - Пропустить")
        print("  m - Ручной ввод")
        print("  q - Выйти из программы")

        while True:
            choice = input("Выберите действие: ").strip().lower()
            if choice in {'s', 'm', 'q'}:
                return choice
            if choice.isdigit() and 1 <= int(choice) <= len(suggestions):
                return choice
            print("Некорректный ввод. Попробуйте снова.")

    def _handle_choice(self, choice: str, suggestions: List[str]) -> str:
        """Обработка выбора пользователя"""
        if choice == 'm':
            return input("Введите исправление: ").strip()
        if choice == 'q':
            raise KeyboardInterrupt
        if choice.isdigit():
            return suggestions[int(choice)-1]
        return ''

    def log_correction(self, log_path: Path, block_num: int, 
                      error: str, suggestions: List[str], 
                      correction: str, action: str):
        """Структурированное логирование в выбранном формате"""
        timestamp = datetime.datetime.now().isoformat()
        with log_path.open('a', encoding='utf-8') as f:
            if self.config['log_format'] == 'markdown':
                f.write(
                    f"\n### Блок {block_num} ({timestamp})\n"
                    f"**Ошибка:** `{error}`\n\n"
                    f"**Предложения:**\n" + 
                    '\n'.join(f"- {s}" for s in suggestions) + '\n\n' +
                    f"**Действие:** {action} → `{correction}`\n"
                )
            else:  
                f.write(
                    f"\n[{timestamp}] Блок {block_num}\n"
                    f"Ошибка: {error}\n"
                    f"Предложения: {', '.join(suggestions)}\n"
                    f"Исправление: {correction} ({action})\n"
                )

def interactive_spellcheck(file_path: str, mode: str = 'paragraph'):
    """Основной процесс проверки с улучшенной обработкой ошибок"""
    path = Path(file_path)
    checker = SpellChecker()
    
    try:
        content = path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"🚨 Ошибка чтения файла: {e}")
        return

    log_path = path.with_name(f"spellcheck_log_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.md")
    output_path = path.with_name(f"corrected_{path.name}")
    
    blocks = re.split(r'\n{2,}', content) if mode == 'paragraph' else content.split('\n')
    
    # Прогресс-бар
    total_blocks = len(blocks)
    print(f"📂 Всего блоков для проверки: {total_blocks}")
    
    try:
        with output_path.open('w', encoding='utf-8') as output_file:
            for i, block in enumerate(blocks, 1):
                if not block.strip():
                    output_file.write(block + ('\n\n' if mode == 'paragraph' else '\n'))
                    continue
                
                processed = checker.process_block(block, i, log_path)
                output_file.write(processed + ('\n\n' if mode == 'paragraph' else '\n'))
                
                print(f"\n✅ Обработано блоков: {i}/{total_blocks} ({i/total_blocks:.1%})")
                print(f"💾 Последнее сохранение: {datetime.datetime.now().strftime('%H:%M:%S')}")
                
    except KeyboardInterrupt:
        print("\n⚠️ Проверка прервана пользователем. Частичные результаты сохранены.")
    
    print(f"\n🔧 Лог исправлений: {log_path}")
    print(f"✨ Итоговый файл: {output_path}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Интерактивная проверка орфографии')
    parser.add_argument('file', help='Путь к .md файлу')
    parser.add_argument('--mode', choices=['paragraph', 'line'], default='paragraph',
                       help='Режим проверки: по абзацам или строкам')
    args = parser.parse_args()

    interactive_spellcheck(args.file, args.mode)
    
# python script_spell_checking.py "example.md" --mode paragraph
