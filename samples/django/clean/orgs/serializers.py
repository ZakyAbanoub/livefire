from rest_framework import serializers

from .models import Membership


class MyOrgSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="org.id", read_only=True)
    name = serializers.CharField(source="org.name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "name", "role"]


class MemberSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "email", "role"]
