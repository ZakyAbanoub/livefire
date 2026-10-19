from rest_framework import serializers

from .models import Note


class NoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ["id", "org", "author", "title", "body", "created_at", "updated_at"]
        read_only_fields = ["org", "author", "created_at", "updated_at"]


class NoteUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Note
        fields = ["id", "title", "body", "updated_at"]
        read_only_fields = ["updated_at"]
