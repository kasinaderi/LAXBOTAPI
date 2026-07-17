import os

components_dir = r"c:\dev\Masterbot\components"
matching_files = []

for root, dirs, files in os.walk(components_dir):
    for file in files:
        if file.endswith(('.tsx', '.ts')):
            path = os.path.join(root, file)
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    if 'tradeLogs' in content:
                        matching_files.append(os.path.relpath(path, components_dir))
            except Exception as e:
                pass

print("FILES:")
for f in matching_files:
    print(f)
