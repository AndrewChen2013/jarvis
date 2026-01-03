# Copyright (c) 2026 BillChen
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
测试 Claude CLI 的路径编码规则

Claude CLI 会将工作目录路径编码为目录名，用于存储 session 文件。
编码规则需要与 Claude CLI 的实际行为完全匹配。

已知的编码规则（从实际目录推断）：
- /Users/bill -> -Users-bill
- /Users/bill/Library/Mobile Documents/com~apple~CloudDocs -> -Users-bill-Library-Mobile-Documents-com-apple-CloudDocs

推断的转换规则：
- "/" -> "-"
- " " (空格) -> "-"
- "~" -> "-"

可能需要处理的其他特殊字符（待验证）：
- 连续的特殊字符
- 中文字符
- 其他特殊符号：@, #, $, %, &, (, ), [, ], ', ", etc.
"""

import pytest
import os


def encode_path_for_claude(path: str) -> str:
    """
    将路径编码为 Claude CLI 使用的目录名格式。

    这个函数需要与 Claude CLI 的实际编码行为完全匹配。
    """
    # 基于实际观察的编码规则
    encoded = path.replace("/", "-").replace(" ", "-").replace("~", "-")
    return encoded


class TestPathEncoding:
    """测试路径编码的各种场景"""

    # ===== 基础场景 =====

    def test_simple_path(self):
        """简单路径：只有斜杠"""
        assert encode_path_for_claude("/Users/bill") == "-Users-bill"

    def test_path_with_spaces(self):
        """包含空格的路径"""
        assert encode_path_for_claude("/Users/bill/My Documents") == "-Users-bill-My-Documents"

    def test_path_with_tilde(self):
        """包含波浪号的路径（如 iCloud 目录）"""
        assert encode_path_for_claude("/Users/bill/Library/Mobile Documents/com~apple~CloudDocs") == \
            "-Users-bill-Library-Mobile-Documents-com-apple-CloudDocs"

    # ===== 已知的实际案例 =====

    def test_real_case_icloud(self):
        """实际案例：iCloud 目录（这是触发 bug 的场景）"""
        path = "/Users/bill/Library/Mobile Documents/com~apple~CloudDocs"
        expected = "-Users-bill-Library-Mobile-Documents-com-apple-CloudDocs"
        assert encode_path_for_claude(path) == expected

    def test_real_case_home(self):
        """实际案例：用户主目录"""
        assert encode_path_for_claude("/Users/bill") == "-Users-bill"

    def test_real_case_project(self):
        """实际案例：项目目录"""
        assert encode_path_for_claude("/Users/bill/claude-remote") == "-Users-bill-claude-remote"

    # ===== 边界情况 =====

    def test_consecutive_spaces(self):
        """连续空格"""
        assert encode_path_for_claude("/path/with  two/spaces") == "-path-with--two-spaces"

    def test_consecutive_tildes(self):
        """连续波浪号"""
        assert encode_path_for_claude("/path/with~~tilde") == "-path-with--tilde"

    def test_mixed_special_chars(self):
        """混合特殊字符"""
        assert encode_path_for_claude("/path/with ~mixed") == "-path-with--mixed"

    def test_trailing_slash(self):
        """末尾斜杠"""
        assert encode_path_for_claude("/Users/bill/") == "-Users-bill-"

    def test_root_path(self):
        """根目录"""
        assert encode_path_for_claude("/") == "-"

    # ===== 其他特殊字符（待验证 - 这些测试可能需要根据实际行为调整）=====

    def test_path_with_dash(self):
        """包含横杠的路径（横杠应保持不变）"""
        assert encode_path_for_claude("/Users/bill/my-project") == "-Users-bill-my-project"

    def test_path_with_underscore(self):
        """包含下划线的路径（下划线应保持不变）"""
        assert encode_path_for_claude("/Users/bill/my_project") == "-Users-bill-my_project"

    def test_path_with_dot(self):
        """包含点的路径（点应保持不变）"""
        assert encode_path_for_claude("/Users/bill/.config") == "-Users-bill-.config"

    # ===== 待验证的特殊字符场景 =====
    # 以下测试需要通过实际运行 Claude CLI 来验证
    # 目前先假设这些字符保持不变

    @pytest.mark.skip(reason="需要验证 Claude CLI 的实际行为")
    def test_path_with_at_symbol(self):
        """包含 @ 符号的路径"""
        # 待验证：@ 是保持不变还是被替换
        pass

    @pytest.mark.skip(reason="需要验证 Claude CLI 的实际行为")
    def test_path_with_hash(self):
        """包含 # 符号的路径"""
        pass

    @pytest.mark.skip(reason="需要验证 Claude CLI 的实际行为")
    def test_path_with_chinese(self):
        """包含中文的路径"""
        pass

    @pytest.mark.skip(reason="需要验证 Claude CLI 的实际行为")
    def test_path_with_parentheses(self):
        """包含括号的路径"""
        pass


class TestSessionFilePath:
    """测试完整的 session 文件路径生成"""

    def test_session_file_path_for_icloud(self):
        """测试 iCloud 目录的 session 文件路径"""
        working_dir = "/Users/bill/Library/Mobile Documents/com~apple~CloudDocs"
        session_id = "ab2ea683-6dab-4403-9a68-00facb8e93ec"
        home = "/Users/bill"

        encoded_path = encode_path_for_claude(working_dir)
        session_file = os.path.join(home, ".claude", "projects", encoded_path, f"{session_id}.jsonl")

        expected = "/Users/bill/.claude/projects/-Users-bill-Library-Mobile-Documents-com-apple-CloudDocs/ab2ea683-6dab-4403-9a68-00facb8e93ec.jsonl"
        assert session_file == expected


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
