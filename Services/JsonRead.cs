/*=====================================================================
   StarLaunch · JSON 读取小工具
   ---------------------------------------------------------------------
   解析外部 JSON（Mojang 版本清单、Modrinth 接口）时到处都是
   「有没有这个字段 / 是不是字符串 / 数字可能是字符串」这类判断，
   集中放一处，免得每个文件各写一遍还写错。
   =====================================================================*/
using System;
using System.Globalization;
using System.Text.Json;

namespace StarLaunch.Services
{
    internal static class JsonRead
    {
        public static string String(JsonElement element, string name)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            {
                return string.Empty;
            }
            return ValueAsString(value);
        }

        /// <summary>字段不存在时返回 null，用来区分「空字符串」和「没有」。 </summary>
        public static string? StringOrNull(JsonElement element, string name)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            {
                return null;
            }
            if (value.ValueKind == JsonValueKind.Null) return null;
            string text = ValueAsString(value);
            return text.Length > 0 ? text : null;
        }

        public static string ValueAsString(JsonElement value)
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    return value.GetString() ?? string.Empty;
                case JsonValueKind.Number:
                    return value.GetRawText();
                case JsonValueKind.True:
                    return "true";
                case JsonValueKind.False:
                    return "false";
                default:
                    return string.Empty;
            }
        }

        public static long Long(JsonElement element, string name, long fallback = 0)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            {
                return fallback;
            }
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long number)) return number;
            if (value.ValueKind == JsonValueKind.String &&
                long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed))
            {
                return parsed;
            }
            return fallback;
        }

        public static int Int(JsonElement element, string name, int fallback = 0)
        {
            long value = Long(element, name, fallback);
            if (value > int.MaxValue) return int.MaxValue;
            if (value < int.MinValue) return int.MinValue;
            return (int)value;
        }

        public static bool Bool(JsonElement element, string name, bool fallback = false)
        {
            if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var value))
            {
                return fallback;
            }
            if (value.ValueKind == JsonValueKind.True) return true;
            if (value.ValueKind == JsonValueKind.False) return false;
            return fallback;
        }

        public static JsonElement Object(JsonElement element, string name)
        {
            return element.ValueKind == JsonValueKind.Object &&
                   element.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.Object
                ? value
                : default;
        }

        public static JsonElement Array(JsonElement element, string name)
        {
            return element.ValueKind == JsonValueKind.Object &&
                   element.TryGetProperty(name, out var value) &&
                   value.ValueKind == JsonValueKind.Array
                ? value
                : default;
        }

        public static bool Has(JsonElement element, string name)
        {
            return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out _);
        }

        /// <summary>把数组里的字符串抓成 List（不存在的字段返回空表）。</summary>
        public static System.Collections.Generic.List<string> Strings(JsonElement element, string name)
        {
            var list = new System.Collections.Generic.List<string>();
            var array = Array(element, name);
            if (array.ValueKind != JsonValueKind.Array) return list;
            foreach (var item in array.EnumerateArray())
            {
                string text = ValueAsString(item);
                if (text.Length > 0) list.Add(text);
            }
            return list;
        }
    }
}
